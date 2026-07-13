# fix-run-state-worker-handles

Record durable agentId/transcript in run-state worker records; correct the within-session SendMessage-revival assumption and make resume robust to name-only worker records.
