to end

Yes bro. The system now works as a **Human + AI sales operating loop**, not as “AI talks to everyone automatically.”

The clean end-to-end flow is:

**Lead Source → CRM Ingestion → Human → AI Follow-Up → Client Reply → Human → AI → Meeting/Proposal → Deal → Won/Lost → Order**

The most important rule behind everything is:

> **When the human finishes, AI starts. When the client responds, AI stops and the human starts.**&#x20;

Here is the actual flow in our platform.

1. **Lead enters the system**

A lead can come from:\
Facebook/Instagram, Google Ads/Search, website forms, landing pages, WhatsApp, email, LinkedIn, Zoho/Bigin sync, import/API, or manual creation when required.

The CRM creates/links the relevant:\
**Company → Contact → Lead**

It assigns the lead to a manager and records source, service, requirement, priority, score/value, campaign and other available information.

The lead initially belongs to the human:

**HUMAN_ACTIVE**

This is important: AI does not immediately take over the sales conversation.

2. **Automatic acknowledgement**

For an inbound lead, the system can immediately send a simple acknowledgement like “we received your inquiry.”

The acknowledgement is automated, but it is **not considered the salesperson’s substantive response**.

So after acknowledgement:

**Ownership remains HUMAN_ACTIVE.**

That separation is explicitly required by the manager specification.&#x20;

3. **Manager gets the lead**

The assigned sales manager sees the lead in:\
**Dashboard / Leads / Human Attention / Tasks**

They can open the Lead Profile and see the complete context:\
lead details, company/contact, source, previous communication, WhatsApp, email, tasks, qualification, documents, meetings, proposals, deals and AI intelligence.

The system creates or surfaces the meaningful next action.

For example:

**Review inquiry and send first substantive CRM response**

4. **Human sends the first meaningful response**

The salesperson reviews the lead and actually performs a meaningful action, such as:\
sending an email, responding on WhatsApp, completing an important call/action, sending requested information, confirming a meeting, etc.

Only after that meaningful human action does the state move:

**HUMAN_ACTIVE → HUMAN_ACTION_COMPLETED → AI_ACTIVE**

That is the handoff from human to AI.&#x20;

5. **AI Follow-Up Engine becomes responsible**

Now AI is allowed to maintain momentum.

It does not just send generic “following up” messages.

It can use:\
email history, WhatsApp history, calls, notes, tasks, qualification, meetings, proposals, deal stage, company data, lead intelligence and grounded document evidence.

It decides among:

**FOLLOW_UP / WAIT / ESCALATE / STOP / ASK_HUMAN**

The timing comes from configurable workflow policies, for example Day 2, Day 5, Day 8, etc., depending on service, lead type, source, country, priority, manager, campaign or pipeline stage.&#x20;

6. **Workflows coordinate automation**

This is where the **Workflow Builder** fits.

A workflow can visually define logic such as:

**Trigger → Condition → If/Else → Wait → Communication → Agent → Task → Human Handoff → End**

For example:

**Human response completed**\
→ wait 2 days\
→ check if client replied\
→ if no reply, invoke Outreach Agent\
→ send follow-up\
→ wait again\
→ if high-risk reply, Ask Human\
→ stop automation.

The Workflow Runtime persists executions, retries safely and avoids duplicate processing.

7. **Agents perform specialized AI work**

The **Agent Composer** is different from the Workflow Builder.

Workflows decide **when and what process runs**.

Agents decide **how a specific AI capability behaves**.

We currently have specialized capabilities such as:\
Outreach, Reply Understanding, Qualification, Proposal, Meeting, Voice, WhatsApp and Sales Copilot.

The Agent Composer can define behavior with nodes like:

**Trigger → Message → Question → Condition → AI Decision → Tool/CRM Action → Integration → Handoff → End**

Published agent versions are immutable, while new edits remain drafts until published.

8. **Client replies**

This is one of the most critical moments.

When a meaningful client reply arrives through email/WhatsApp or another supported communication path:

**AI immediately stops.**

The ownership flow becomes approximately:

**AI_ACTIVE → AI_STOPPED → HUMAN_REQUIRED**

Pending automated follow-ups are blocked.

The assigned manager receives an action-required notification and a human-response task.

The spec explicitly requires that AI must not continue sending follow-ups while a real client response is waiting for human intervention.&#x20;

9. **Reply is classified**

Not every inbound email should interrupt the salesperson.

The system distinguishes meaningful responses from things such as:\
out-of-office replies, bounces, newsletters and irrelevant system messages.

A genuine sales response triggers human attention.

For example:

> “We are interested. Can we discuss pricing next week?”

That becomes **Human Required**.

10. **Salesperson responds again**

The manager opens the complete timeline, understands the client’s message and performs the next meaningful human action.

For example:\
answers the question, sends requested information, schedules a meeting, updates qualification or handles an objection.

Once that human action is completed safely:

**AI can become active again.**

So the loop repeats:

**Human → AI → Client → Human → AI**

until the opportunity reaches a terminal outcome.

11. **Qualification**

During the cycle, the salesperson or supporting AI can capture things like:\
need, budget, authority, timeline, urgency, objections, score and opportunity quality.

Qualification is intelligence about the lead; it does not necessarily need to be a fixed pipeline stage because the sales pipeline is configurable.

12. **Lead Intelligence keeps the memory**

Every important interaction updates durable Lead Intelligence.

It can maintain:\
summary, customer need, objections, commitments, communication style, next objective, health score and evidence.

This is what prevents AI from forgetting what happened earlier.

The AI should know:\
what was discussed, what the customer said, what the salesperson promised, what documents were shared, what objections exist and why the customer should respond now.

13. **Document Intelligence provides grounded knowledge**

Audits, proposals, pricing documents, presentations and other relevant documents can be attached/indexed.

AI can use extracted evidence from those documents in follow-ups.

But if the document cannot be read or the evidence does not exist, AI must not invent it.&#x20;

14. **Meeting flow**

If the customer wants a call:

**Client Reply → HUMAN_REQUIRED → Manager schedules meeting**

The system can then:\
suggest/request slots, create a meeting, integrate with calendar, record the meeting, send confirmation and reminders, and add it to the activity timeline.

After the manager completes the meeting action/notes, AI may take over follow-up again.

15. **Proposal flow**

When the opportunity reaches proposal stage:

Lead/deal context is used to prepare the proposal.

Human review remains important for:\
pricing, scope, dates, discounts and commitments.

After approval, the proposal is sent and recorded in:\
proposal history, communication timeline, activity and agent/workflow execution.

If there is no response, AI can resume contextual follow-ups.

16. **Negotiation forces human judgment**

This is where AI safety becomes very strict.

If the client says something like:

> “Can you give us a 25% discount and change these legal terms?”

the AI should not negotiate by itself.

The decision should be:

**ASK_HUMAN / ESCALATE**

Pricing negotiations, contractual changes, complaints, refunds, legal matters, sensitive information and major objections require human intervention.&#x20;

17. **Deal / Sales Pipeline**

Once there is a real opportunity, it is managed as a Deal.

This is where the **Sales Pipeline / Kanban** belongs.

A typical configured progression may look like:

**New Lead → Acknowledged → Human Contact → AI Follow-Up → Client Replied → Human Action → Meeting → Proposal → Negotiation → Won/Lost**

The exact stages are configurable.&#x20;

The Deals screen should expose:\
**List view + Kanban/Pipeline view**

Cards use real persisted deals, and dragging a card to another stage updates the deal, activity/audit records and realtime state.

18. **Won / Lost / Closed / DNC**

Eventually the opportunity reaches a terminal state.

If **Won**:\
sales automation stops and the relationship can continue into post-sale/order activity.

If **Lost**:\
follow-up stops and the loss reason is preserved.

If **Do Not Contact**:\
email, WhatsApp, voice, agents and workflows must all stop.

Terminal states are not allowed to accidentally reactivate AI.

19. **Order flow**

Orders are our extended CRM/post-sale capability.

For a won deal:

**Company + Contact + Deal → Order**

Order items are added and payment/fulfillment are tracked independently, for example:

**Payment:** Partially Paid → Paid\
**Fulfillment:** Processing → Fulfilled

Orders then appear in the Order Queue, detail view, activity history and related KPIs.

20. **Manager Dashboard / AI Command Center**

Throughout this entire lifecycle, managers see operational intelligence such as:\
New Leads, Human Attention Required, AI Follow-Ups Running, Meetings Today, Replies Received, Overdue Actions, Hot Leads, Proposal Pending, Negotiation, Won/Lost and AI activity.&#x20;

The AI Command Center also provides lead intelligence, recommendations and Human-vs-AI signals.

21. **Human and AI performance are measured separately**

Human KPIs include things such as:\
response time, leads handled, proposals, meetings, conversion, revenue and deal value.

AI KPIs include:\
follow-ups sent, replies generated, meetings generated, re-engagement, revived leads, interventions and AI-to-human handoffs.&#x20;

22. **Integrations are infrastructure, not the CRM itself**

The CRM is the source of truth.

Bigin, email providers, WhatsApp, voice, calendars and AI providers connect through the Integration layer.

So conceptually:

**External Source / Provider**\
→ **Integration**\
→ **Shilabs CRM**\
→ **Workflow**\
→ **Agent / Human**\
→ **Provider action**

If an integration is disabled or unhealthy, the related automated action should fail safely rather than pretending it succeeded.

The simplest way to remember the whole platform is:

**Lead arrives**\
↓\
**CRM creates & assigns it**\
↓\
**Automatic acknowledgement**\
↓\
**Human handles meaningful first interaction**\
↓\
**AI follows up**\
↓\
**Client responds**\
↓\
**AI stops**\
↓\
**Human handles response**\
↓\
**AI resumes**\
↓\
**Meeting**\
↓\
**Proposal**\
↓\
**Negotiation → Human**\
↓\
**Deal Won / Lost**\
↓\
**Order / post-sale if Won**

And running beside that main flow are:

**Workflows = orchestration**\
**Agents = specialized AI behavior**\
**Integrations = external channels/providers**\
**Lead Intelligence = memory/context**\
**Pipeline = sales progression**\
**Tasks = human accountability**\
**Activity/Audit = complete traceability**\
**Command Center = manager intelligence**

That is the full intended Shilabs CRM flow now.