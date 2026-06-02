# FERRET activation passes

A FERRET activation codeword is provisioned out-of-band: the system issues a
short-lived activation pass bound to a single device. On first use the pass is
combined with the account secret to derive the session key. The codeword itself
is never transmitted in cleartext and is rotated per deployment.
