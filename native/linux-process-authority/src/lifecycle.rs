use std::fmt;
use std::io;

const JOURNAL_MAGIC: &[u8; 4] = b"RPJ1";
const JOURNAL_VERSION: u16 = 1;
const EVENT_BYTES: usize = 16;
const MAX_EVENTS: usize = 16;
const LINUX_MAX_EXIT_CODE: i32 = 255;
const LINUX_MAX_SIGNAL: i32 = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RootExit {
    Code(i32),
    Signal(i32),
}

impl RootExit {
    pub fn try_from_parts(code: Option<i32>, signal: Option<i32>) -> io::Result<Self> {
        match (code, signal) {
            (Some(value), None) if (0..=LINUX_MAX_EXIT_CODE).contains(&value) => {
                Ok(Self::Code(value))
            }
            (None, Some(value)) if (1..=LINUX_MAX_SIGNAL).contains(&value) => {
                Ok(Self::Signal(value))
            }
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "root exit must have exactly one valid code or signal",
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum GuardianEventKind {
    Prepared = 1,
    Activated = 2,
    RootExited = 3,
    ExactScopeEmpty = 4,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GuardianEvent {
    pub sequence: u64,
    pub kind: GuardianEventKind,
    pub root_exit: Option<RootExit>,
}

impl GuardianEvent {
    pub fn prepared() -> Self {
        Self {
            sequence: 1,
            kind: GuardianEventKind::Prepared,
            root_exit: None,
        }
    }

    pub fn activated(sequence: u64) -> Self {
        Self {
            sequence,
            kind: GuardianEventKind::Activated,
            root_exit: None,
        }
    }

    pub fn root_exited(sequence: u64, root_exit: RootExit) -> Self {
        Self {
            sequence,
            kind: GuardianEventKind::RootExited,
            root_exit: Some(root_exit),
        }
    }

    pub fn exact_empty(sequence: u64) -> Self {
        Self {
            sequence,
            kind: GuardianEventKind::ExactScopeEmpty,
            root_exit: None,
        }
    }

    /// Exact empty following activation without a root-exit event is the
    /// closed journal representation for a kernel teardown proof whose root
    /// result was lost with the guardian.
    pub fn root_result_lost(events: &[Self]) -> bool {
        events.last().map(|event| event.kind) == Some(GuardianEventKind::ExactScopeEmpty)
            && events
                .iter()
                .any(|event| event.kind == GuardianEventKind::Activated)
            && events
                .iter()
                .all(|event| event.kind != GuardianEventKind::RootExited)
    }

    pub fn encode_journal(events: &[Self]) -> io::Result<Vec<u8>> {
        validate_events(events)?;
        let mut output = Vec::with_capacity(8 + events.len() * EVENT_BYTES);
        output.extend_from_slice(JOURNAL_MAGIC);
        output.extend_from_slice(&JOURNAL_VERSION.to_be_bytes());
        output.extend_from_slice(&(events.len() as u16).to_be_bytes());
        for event in events {
            output.extend_from_slice(&event.sequence.to_be_bytes());
            output.push(event.kind as u8);
            let (tag, value) = match event.root_exit {
                None => (0, 0),
                Some(RootExit::Code(code)) => (1, code),
                Some(RootExit::Signal(signal)) => (2, signal),
            };
            output.push(tag);
            output.extend_from_slice(&0_u16.to_be_bytes());
            output.extend_from_slice(&value.to_be_bytes());
        }
        Ok(output)
    }

    pub fn decode_journal(bytes: &[u8]) -> io::Result<Vec<Self>> {
        if bytes.len() < 8
            || &bytes[..4] != JOURNAL_MAGIC
            || u16::from_be_bytes([bytes[4], bytes[5]]) != JOURNAL_VERSION
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "guardian journal header is invalid",
            ));
        }
        let count = u16::from_be_bytes([bytes[6], bytes[7]]) as usize;
        if count > MAX_EVENTS || bytes.len() != 8 + count * EVENT_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "guardian journal length is invalid",
            ));
        }
        let mut events = Vec::with_capacity(count);
        for chunk in bytes[8..].chunks_exact(EVENT_BYTES) {
            let sequence = u64::from_be_bytes(chunk[..8].try_into().expect("fixed event"));
            let kind = match chunk[8] {
                1 => GuardianEventKind::Prepared,
                2 => GuardianEventKind::Activated,
                3 => GuardianEventKind::RootExited,
                4 => GuardianEventKind::ExactScopeEmpty,
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "guardian event kind is invalid",
                    ))
                }
            };
            if chunk[10] != 0 || chunk[11] != 0 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "guardian event reserved bytes are nonzero",
                ));
            }
            let value = i32::from_be_bytes(chunk[12..16].try_into().expect("fixed event"));
            let root_exit = match chunk[9] {
                0 if value == 0 => None,
                1 => Some(RootExit::try_from_parts(Some(value), None)?),
                2 => Some(RootExit::try_from_parts(None, Some(value))?),
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "guardian event status is invalid",
                    ))
                }
            };
            events.push(Self {
                sequence,
                kind,
                root_exit,
            });
        }
        validate_events(&events)?;
        Ok(events)
    }
}

fn validate_events(events: &[GuardianEvent]) -> io::Result<()> {
    if events.is_empty() || events.len() > MAX_EVENTS {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "guardian event count is invalid",
        ));
    }
    for (index, event) in events.iter().enumerate() {
        if event.sequence != index as u64 + 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "guardian event sequence is invalid",
            ));
        }
        match event.kind {
            GuardianEventKind::Prepared | GuardianEventKind::Activated => {
                if event.root_exit.is_some() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "non-exit event contains root status",
                    ));
                }
            }
            GuardianEventKind::RootExited => {
                if event.root_exit.is_none() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "root-exited event lacks exact status",
                    ));
                }
            }
            GuardianEventKind::ExactScopeEmpty => {
                if event.root_exit.is_some() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "empty event contains root status",
                    ));
                }
            }
        }
        let allowed = if index == 0 {
            event.kind == GuardianEventKind::Prepared
        } else {
            matches!(
                (events[index - 1].kind, event.kind),
                (GuardianEventKind::Prepared, GuardianEventKind::Activated)
                    | (
                        GuardianEventKind::Prepared,
                        GuardianEventKind::ExactScopeEmpty
                    )
                    | (
                        GuardianEventKind::Activated,
                        GuardianEventKind::ExactScopeEmpty
                    )
                    | (GuardianEventKind::Activated, GuardianEventKind::RootExited)
                    | (
                        GuardianEventKind::RootExited,
                        GuardianEventKind::ExactScopeEmpty
                    )
            )
        };
        if !allowed
            || (event.kind == GuardianEventKind::ExactScopeEmpty && index + 1 != events.len())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "guardian event transition is invalid",
            ));
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GuardianObservation {
    Inert,
    Live,
    RootExited(RootExit),
    ExactScopeEmpty,
}

impl fmt::Display for GuardianObservation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Inert => formatter.write_str("inert"),
            Self::Live => formatter.write_str("live"),
            Self::RootExited(_) => formatter.write_str("root-exited"),
            Self::ExactScopeEmpty => formatter.write_str("exact-scope-empty"),
        }
    }
}

pub struct GuardianMachine {
    events: Vec<GuardianEvent>,
    descendants_remain: bool,
}

impl GuardianMachine {
    pub fn prepared() -> Self {
        Self {
            events: vec![GuardianEvent::prepared()],
            descendants_remain: false,
        }
    }

    pub fn events(&self) -> &[GuardianEvent] {
        &self.events
    }

    pub fn activate(&mut self) -> io::Result<GuardianEvent> {
        if self.events.len() != 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "guardian activation is exactly once",
            ));
        }
        let event = GuardianEvent::activated(2);
        self.events.push(event);
        Ok(event)
    }

    pub fn abort_inert(&mut self) -> io::Result<GuardianEvent> {
        if self.events.len() != 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "only an inert guardian can take the inert abort transition",
            ));
        }
        let event = GuardianEvent::exact_empty(2);
        self.events.push(event);
        Ok(event)
    }

    pub fn root_exited(
        &mut self,
        root_exit: RootExit,
        descendants_remain: bool,
    ) -> io::Result<GuardianEvent> {
        if self.events.last().map(|event| event.kind) != Some(GuardianEventKind::Activated) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "root exit is out of order",
            ));
        }
        let event = GuardianEvent::root_exited(3, root_exit);
        self.events.push(event);
        self.descendants_remain = descendants_remain;
        Ok(event)
    }

    pub fn descendants_empty(&mut self) -> io::Result<GuardianEvent> {
        if self.events.last().map(|event| event.kind) != Some(GuardianEventKind::RootExited) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "exact child-set empty is not established",
            ));
        }
        self.descendants_remain = false;
        let event = GuardianEvent::exact_empty(4);
        self.events.push(event);
        Ok(event)
    }

    pub fn exact_empty(&self) -> io::Result<GuardianEvent> {
        self.events
            .last()
            .copied()
            .filter(|event| event.kind == GuardianEventKind::ExactScopeEmpty)
            .ok_or_else(|| io::Error::new(io::ErrorKind::WouldBlock, "scope is not exactly empty"))
    }

    pub fn observe(&self) -> GuardianObservation {
        match self.events.last().expect("prepared event").kind {
            GuardianEventKind::Prepared => GuardianObservation::Inert,
            GuardianEventKind::Activated => GuardianObservation::Live,
            GuardianEventKind::RootExited => GuardianObservation::RootExited(
                self.events
                    .last()
                    .and_then(|event| event.root_exit)
                    .expect("validated root exit"),
            ),
            GuardianEventKind::ExactScopeEmpty => GuardianObservation::ExactScopeEmpty,
        }
    }
}
