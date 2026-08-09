use std::io;
use std::mem::size_of;
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;

use crate::broker_protocol::{
    BrokerFrame, BrokerFrameKind, BrokerRequest, ClientHello, PeerCredentials,
    PinnedBrokerIdentity, SigningBrokerIdentity,
};

pub fn peer_credentials(stream: &UnixStream) -> io::Result<PeerCredentials> {
    let mut credentials = std::mem::MaybeUninit::<libc::ucred>::zeroed();
    let mut length = size_of::<libc::ucred>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            credentials.as_mut_ptr().cast(),
            &mut length,
        )
    };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    if length as usize != size_of::<libc::ucred>() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Unix peer credentials have an unexpected size",
        ));
    }
    let credentials = unsafe { credentials.assume_init() };
    if credentials.pid <= 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Unix peer credentials are malformed",
        ));
    }
    let peer = PeerCredentials {
        pid: credentials.pid as u32,
        uid: credentials.uid,
        gid: credentials.gid,
    };
    peer.validate()?;
    Ok(peer)
}

pub fn accept_authenticated_request(
    stream: &mut UnixStream,
    signer: &SigningBrokerIdentity,
) -> io::Result<(PeerCredentials, ClientHello, BrokerRequest)> {
    let peer = peer_credentials(stream)?;
    let frame = BrokerFrame::read_from(stream)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "client hello is absent"))?;
    if frame.kind != BrokerFrameKind::ClientHello {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "first broker frame is not a client hello",
        ));
    }
    let hello = ClientHello::decode(&frame.payload)?;
    let answer = signer.answer_challenge(&hello, peer)?;
    BrokerFrame::new(BrokerFrameKind::BrokerHello, answer.encode()?)?.write_to(stream)?;
    let frame = BrokerFrame::read_from(stream)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "broker request is absent"))?;
    if frame.kind != BrokerFrameKind::Request {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "authenticated broker frame is not a request",
        ));
    }
    let request = BrokerRequest::decode(&frame.payload)?;
    if request.challenge_nonce != hello.nonce || request.caller_uid != peer.uid {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "broker request is not bound to its authenticated hello",
        ));
    }
    Ok((peer, hello, request))
}

pub fn authenticate_broker(
    stream: &mut UnixStream,
    pinned: &PinnedBrokerIdentity,
    hello: &ClientHello,
) -> io::Result<PeerCredentials> {
    authenticate_broker_for_uid(stream, pinned, hello, 0)
}

/// Executes the exact shipping challenge/peer transaction while allowing an
/// isolated non-installed oracle to state its expected daemon uid explicitly.
/// Production callers use `authenticate_broker`, which fixes this value at 0.
pub fn authenticate_broker_for_uid(
    stream: &mut UnixStream,
    pinned: &PinnedBrokerIdentity,
    hello: &ClientHello,
    expected_broker_uid: u32,
) -> io::Result<PeerCredentials> {
    let local = PeerCredentials {
        pid: unsafe { libc::getpid() } as u32,
        uid: unsafe { libc::geteuid() },
        gid: unsafe { libc::getegid() },
    };
    local.validate()?;
    BrokerFrame::new(BrokerFrameKind::ClientHello, hello.encode()?)?.write_to(stream)?;
    let frame = BrokerFrame::read_from(stream)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "broker hello is absent"))?;
    if frame.kind != BrokerFrameKind::BrokerHello {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "broker did not return a challenge answer",
        ));
    }
    let answer = crate::broker_protocol::BrokerHello::decode(&frame.payload)?;
    let broker = peer_credentials(stream)?;
    pinned.verify_challenge_for_broker_uid(hello, &answer, local, broker, expected_broker_uid)?;
    Ok(broker)
}
