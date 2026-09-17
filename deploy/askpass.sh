#!/bin/sh
# ssh askpass helper: answers ssh's password prompt from the environment.
#
# ssh runs this as `askpass.sh "<prompt>"` and reads the answer from stdout.
# The secret lives only in TP_VPS_PASSWORD in the caller's environment — it is
# never an argument (which lands in the process list) and never written to a file
# (an earlier version of the caller dropped it into ${TMPDIR}, where it outlived
# the run). Set SSH_ASKPASS_REQUIRE=force so ssh uses it without a terminal.
printf '%s\n' "${TP_VPS_PASSWORD:?TP_VPS_PASSWORD must be set in the environment}"
