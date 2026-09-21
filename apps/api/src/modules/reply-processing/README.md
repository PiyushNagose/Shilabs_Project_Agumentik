# Reply Processing Module

R10 understands inbound replies and creates grounded response drafts/control recommendations.

The module:

- processes persisted `InboundEmail` records
- builds context from saved messages, lead state, qualification and approved knowledge only
- calls `AIProvider.understandReply`
- validates message evidence and approved knowledge references
- persists `ReplyProcessingRun` input/output/provider/model/failure metadata
- pauses conversations for not-interested replies
- switches conversations to human mode for negotiation/proposal/meeting review paths

It does not send email, schedule follow-ups, generate proposals, book meetings or write fake
provider delivery state.
