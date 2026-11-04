//! The squat-proof, impersonation-proof control endpoint (tasks 4.5 and the transport half of
//! 7.3/7.4).
//!
//! The endpoint is a named pipe created with `FILE_FLAG_FIRST_PIPE_INSTANCE` and a maximum
//! instance count of one, so an attacker can neither pre-create the name and receive our
//! connections nor add a second instance behind ours. Remote clients are rejected. The DACL
//! grants exactly the creating user's SID: no inherited ACEs, no `Everyone`, no `NULL` DACL.
//!
//! A pipe name, a process id, or a successful connection is never identity on its own. The
//! client authenticates the server and the server authenticates the client, and both do so
//! again after every handle is open.

use std::io;
use std::ptr::null_mut;

use crate::stateroot::endpoint_name;
use crate::sys::*;
use crate::win::{self, last_error, last_error_code, OwnedHandle, OwnedSid, OwnerOnlySecurity};

/// The server side, owned by the guardian.
pub struct ControlEndpointServer {
    pipe: OwnedHandle,
    name: String,
    owner: OwnedSid,
    #[allow(dead_code)]
    security: Box<OwnerOnlySecurity>,
    connected: bool,
}

impl ControlEndpointServer {
    /// Create the endpoint as a first instance. An existing name is a typed failure, never a
    /// reuse.
    pub fn create(scope_id: &str, owner: &OwnedSid) -> io::Result<Self> {
        let name = endpoint_name(scope_id)?;
        let mut security = OwnerOnlySecurity::new(owner, FILE_ALL_ACCESS)?;
        let wide_name = win::wide(&name);
        let raw = unsafe {
            CreateNamedPipeW(
                wide_name.as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                64 * 1024,
                64 * 1024,
                0,
                security.attributes(),
            )
        };
        if raw == INVALID_HANDLE_VALUE || raw.is_null() {
            let code = last_error_code();
            // Measured on the real kernel: with `nMaxInstances = 1` a second creation of the
            // same name is refused with `ERROR_PIPE_BUSY` (231) before
            // `FILE_FLAG_FIRST_PIPE_INSTANCE` can report `ERROR_ACCESS_DENIED` (5). Both, and
            // `ERROR_ALREADY_EXISTS`, mean the same thing here: the name is taken, and that is
            // a typed failure rather than a reuse.
            if code == ERROR_ACCESS_DENIED || code == ERROR_ALREADY_EXISTS || code == ERROR_PIPE_BUSY
            {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    format!(
                        "authority-unavailable: the control endpoint name is already taken \
                         (os error {code})"
                    ),
                ));
            }
            return Err(last_error("CreateNamedPipeW"));
        }
        let pipe = unsafe { OwnedHandle::from_raw(raw) };
        // Read the owner back from the kernel object rather than trusting the descriptor we
        // supplied.
        let observed = win::kernel_object_owner_sid(pipe.raw())?;
        if !observed.equals(owner) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "the created endpoint is not owned by the expected SID",
            ));
        }
        Ok(Self {
            pipe,
            name,
            owner: observed,
            security,
            connected: false,
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn owner(&self) -> &OwnedSid {
        &self.owner
    }

    pub fn raw(&self) -> Handle {
        self.pipe.raw()
    }

    /// Block until a client connects.
    pub fn accept(&mut self, overlapped: &win::OverlappedContext) -> io::Result<()> {
        overlapped.connect(self.pipe.raw())?;
        self.connected = true;
        Ok(())
    }

    pub fn disconnect(&mut self) -> io::Result<()> {
        if !self.connected {
            return Ok(());
        }
        self.connected = false;
        // `DisconnectNamedPipe` discards any data the client has not yet read. Measured on the
        // real kernel: disconnecting straight after writing a typed failure frame delivered
        // the 12-byte header and destroyed the 3-byte payload, so the controller saw
        // "truncated failure frame payload" instead of the failure code the guardian actually
        // produced. Flushing first is the documented remedy and is what keeps a typed failure
        // typed.
        if unsafe { FlushFileBuffers(self.pipe.raw()) } == FALSE {
            let code = last_error_code();
            if code != ERROR_BROKEN_PIPE && code != ERROR_PIPE_NOT_CONNECTED {
                return Err(last_error("FlushFileBuffers endpoint"));
            }
        }
        if unsafe { DisconnectNamedPipe(self.pipe.raw()) } == FALSE {
            return Err(last_error("DisconnectNamedPipe"));
        }
        Ok(())
    }

    /// Authenticate the connected client: its process id, and its user SID read through an
    /// identification-level impersonation. The control capability is checked separately by the
    /// caller; neither alone is authority.
    pub fn authenticate_client(&self) -> io::Result<ClientIdentity> {
        let mut process_id: Dword = 0;
        if unsafe { GetNamedPipeClientProcessId(self.pipe.raw(), &mut process_id) } == FALSE {
            return Err(last_error("GetNamedPipeClientProcessId"));
        }
        let sid = win::named_pipe_client_sid(self.pipe.raw())?;
        if !sid.equals(&self.owner) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "identity-drift: the endpoint client is a different user",
            ));
        }
        Ok(ClientIdentity { process_id, sid })
    }
}

impl std::fmt::Debug for ControlEndpointServer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ControlEndpointServer")
            .field("name", &self.name)
            .field("connected", &self.connected)
            .finish()
    }
}

impl std::fmt::Debug for ControlEndpointClient {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ControlEndpointClient")
            .field("tuple", &self.tuple)
            .finish()
    }
}

#[derive(Clone, Debug)]
pub struct ClientIdentity {
    pub process_id: u32,
    pub sid: OwnedSid,
}

/// The identity tuple a controller must observe as stable across the whole reopen sequence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServerIdentityTuple {
    pub guardian_process_id: u32,
    pub guardian_birth: u64,
    pub endpoint_server_process_id: u32,
    pub endpoint_owner_sid_text: String,
}

/// The client side, used by a controller or a replacement controller.
pub struct ControlEndpointClient {
    pipe: OwnedHandle,
    tuple: ServerIdentityTuple,
}

impl ControlEndpointClient {
    /// Connect and authenticate in the order Decision 9 requires. The caller supplies the
    /// values bound into the reference; nothing here is discovered and then trusted.
    pub fn connect(
        scope_id: &str,
        expected_guardian_process_id: u32,
        expected_guardian_birth: u64,
        expected_owner_sid_text: &str,
    ) -> io::Result<Self> {
        let name = endpoint_name(scope_id)?;

        // 1. Open the guardian and read its birth identity *before* touching the endpoint.
        let guardian = win::open_process(
            PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
            expected_guardian_process_id,
        )
        .map_err(|error| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("guardian process is absent: {error}"),
            )
        })?;
        let birth_before = win::process_creation_filetime(guardian.raw())?;
        if birth_before != expected_guardian_birth {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "identity-drift: guardian process id is occupied by a different process",
            ));
        }

        // 2. Connect at identification level, so a hostile pipe server cannot impersonate us.
        let wide_name = win::wide(&name);
        let raw = unsafe {
            CreateFileW(
                wide_name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                null_mut(),
                OPEN_EXISTING,
                SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION | FILE_FLAG_OVERLAPPED,
                null_mut(),
            )
        };
        if raw == INVALID_HANDLE_VALUE || raw.is_null() {
            let code = last_error_code();
            return Err(io::Error::new(
                if code == ERROR_PIPE_BUSY {
                    io::ErrorKind::WouldBlock
                } else {
                    io::ErrorKind::NotFound
                },
                format!("control endpoint is unreachable (os error {code})"),
            ));
        }
        let pipe = unsafe { OwnedHandle::from_raw(raw) };

        // 3. Authenticate the server through the connection we now hold.
        let mut server_process_id: Dword = 0;
        if unsafe { GetNamedPipeServerProcessId(pipe.raw(), &mut server_process_id) } == FALSE {
            return Err(last_error("GetNamedPipeServerProcessId"));
        }
        if server_process_id != expected_guardian_process_id {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "identity-drift: the endpoint is served by a different process",
            ));
        }
        let owner = win::kernel_object_owner_sid(pipe.raw())?;
        let owner_text = owner.to_text()?;
        if owner_text != expected_owner_sid_text {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "identity-drift: the endpoint owner differs from the reference",
            ));
        }

        let tuple = ServerIdentityTuple {
            guardian_process_id: expected_guardian_process_id,
            guardian_birth: birth_before,
            endpoint_server_process_id: server_process_id,
            endpoint_owner_sid_text: owner_text,
        };

        let client = Self { pipe, tuple };

        // 4. Mandatory post-open reread of the complete tuple. This closes the window in which
        //    the referenced process exits between lookup and use and a new process takes its
        //    id. Task 9.5's RED skips exactly this step.
        let reread = client.read_identity_tuple(expected_guardian_process_id)?;
        if reread != client.tuple {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "identity-drift: the identity tuple changed after handles were opened",
            ));
        }
        Ok(client)
    }

    /// Read the full identity tuple again through the handles that are already open.
    pub fn read_identity_tuple(&self, guardian_process_id: u32) -> io::Result<ServerIdentityTuple> {
        let guardian = win::open_process(
            PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
            guardian_process_id,
        )?;
        let birth = win::process_creation_filetime(guardian.raw())?;
        let mut server_process_id: Dword = 0;
        if unsafe { GetNamedPipeServerProcessId(self.pipe.raw(), &mut server_process_id) } == FALSE
        {
            return Err(last_error("GetNamedPipeServerProcessId reread"));
        }
        let owner = win::kernel_object_owner_sid(self.pipe.raw())?;
        Ok(ServerIdentityTuple {
            guardian_process_id,
            guardian_birth: birth,
            endpoint_server_process_id: server_process_id,
            endpoint_owner_sid_text: owner.to_text()?,
        })
    }

    pub fn tuple(&self) -> &ServerIdentityTuple {
        &self.tuple
    }

    pub fn raw(&self) -> Handle {
        self.pipe.raw()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(tag: u8) -> String {
        let mut id = format!("{:032x}", u128::from(tag) << 96 | 0x5ca1e);
        id.truncate(32);
        id
    }

    #[test]
    fn an_endpoint_is_created_as_a_first_instance_and_the_name_cannot_be_taken_twice() {
        let owner = win::current_user_sid().expect("sid");
        let id = scope(1);
        let server = ControlEndpointServer::create(&id, &owner).expect("create");
        assert!(server.name().starts_with("\\\\.\\pipe\\rasen-wpa-"));
        assert!(server.owner().equals(&owner));

        // The contract requires an existing name to be a typed failure, never a reuse. A
        // second first-instance creation of the same name must be refused by the kernel.
        let second = ControlEndpointServer::create(&id, &owner);
        let error = second.expect_err("a second instance was created");
        assert!(
            error.to_string().contains("already taken"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn a_client_connecting_to_a_wrong_guardian_identity_is_refused_before_any_frame() {
        let owner = win::current_user_sid().expect("sid");
        let id = scope(2);
        let _server = ControlEndpointServer::create(&id, &owner).expect("create");
        let real = win::current_process_id();
        let birth = win::process_birth(real).expect("birth");
        let owner_text = owner.to_text().expect("sid text");

        // Wrong birth identity for a real, live process id: the classic identifier-reuse case.
        let error = ControlEndpointClient::connect(&id, real, birth ^ 0xff, &owner_text)
            .expect_err("wrong birth accepted");
        assert!(
            error.to_string().contains("identity-drift"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn a_client_connecting_to_an_absent_scope_fails_closed() {
        let owner = win::current_user_sid().expect("sid");
        let id = scope(3);
        let real = win::current_process_id();
        let birth = win::process_birth(real).expect("birth");
        let owner_text = owner.to_text().expect("sid text");
        let error = ControlEndpointClient::connect(&id, real, birth, &owner_text)
            .expect_err("absent endpoint accepted");
        assert!(error.to_string().contains("unreachable"), "{error}");
    }

    #[test]
    fn identity_tuples_compare_by_every_field() {
        let base = ServerIdentityTuple {
            guardian_process_id: 10,
            guardian_birth: 20,
            endpoint_server_process_id: 10,
            endpoint_owner_sid_text: "S-1-5-21".to_owned(),
        };
        for mutated in [
            ServerIdentityTuple {
                guardian_process_id: 11,
                ..base.clone()
            },
            ServerIdentityTuple {
                guardian_birth: 21,
                ..base.clone()
            },
            ServerIdentityTuple {
                endpoint_server_process_id: 11,
                ..base.clone()
            },
            ServerIdentityTuple {
                endpoint_owner_sid_text: "S-1-5-22".to_owned(),
                ..base.clone()
            },
        ] {
            assert_ne!(mutated, base, "a tuple field is not compared");
        }
    }
}
