const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/gu, "");
  }
}

const runtimeEnv = { ...process.env };
loadEnv(path.resolve(".env"));
Object.assign(process.env, runtimeEnv);

const baseUrl = process.env.LIVE_FLOW_WEB_URL || "http://localhost:5174";
const apiUrl =
  process.env.LIVE_FLOW_API_URL || process.env.VITE_API_BASE_URL || "http://localhost:4010";
const outputDir =
  process.env.LIVE_FLOW_OUTPUT_DIR || path.join(os.tmpdir(), "shilabs-live-manager-flow");
const activeBrowsers = new Set();
const statePath = path.join(outputDir, "state.json");
const authPath = path.join(outputDir, "auth.json");
fs.mkdirSync(outputDir, { recursive: true });

async function authenticate() {
  if (fs.existsSync(authPath)) {
    const cached = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const check = await fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${cached.accessToken}` }
    });
    if (check.ok) return cached;
  }
  const response = await fetch(`${apiUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.LIVE_FLOW_ADMIN_EMAIL || process.env.DEV_ADMIN_EMAIL,
      password: process.env.LIVE_FLOW_ADMIN_PASSWORD || process.env.DEV_ADMIN_PASSWORD
    })
  });
  if (!response.ok) throw new Error(`Login failed (${response.status})`);
  const auth = await response.json();
  fs.writeFileSync(authPath, JSON.stringify(auth));
  return auth;
}

async function apiGet(route, token) {
  const response = await fetch(`${apiUrl}${route}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`${route} failed (${response.status})`);
  return response.json();
}

async function apiPost(route, token, body) {
  const response = await fetch(`${apiUrl}${route}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${route} failed (${response.status})`);
  return response.json();
}

async function apiPut(route, token, body) {
  const response = await fetch(`${apiUrl}${route}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${route} failed (${response.status})`);
  return response.json();
}

async function apiPatch(route, token, body) {
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(`${apiUrl}${route}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (response.status !== 429) break;
    const retrySeconds = Number(response.headers.get("retry-after") || "1");
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, retrySeconds) * 1000));
  }
  if (!response) throw new Error(`${route} returned no response`);
  if (!response.ok) throw new Error(`${route} failed (${response.status})`);
  return response.json();
}

async function waitForApi(check, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastValue;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await check();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `Timed out waiting for persisted state; last value: ${JSON.stringify(lastValue)}`
  );
}

async function openAuthenticatedPage(auth) {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  activeBrowsers.add(browser);
  browser.on("disconnected", () => activeBrowsers.delete(browser));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.addInitScript(({ accessToken, user }) => {
    localStorage.setItem("shilabs.accessToken", accessToken);
    localStorage.setItem("shilabs.user", JSON.stringify(user));
  }, auth);
  return { browser, page, browserErrors };
}

async function verifyAcknowledgement(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run step 1 before step 2");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const lead = await apiGet(`/api/leads/${state.leadId}`, auth.accessToken);
  const [activities, conversations] = await Promise.all([
    apiGet(`/api/leads/${state.leadId}/activities`, auth.accessToken),
    apiGet(`/api/conversations?leadId=${state.leadId}`, auth.accessToken)
  ]);
  const mailpitResponse = await fetch(
    `${process.env.MAILPIT_HTTP_URL || "http://localhost:8025"}/api/v1/search?query=${encodeURIComponent(`to:${state.data.email}`)}`
  );
  if (!mailpitResponse.ok) throw new Error(`Mailpit lookup failed (${mailpitResponse.status})`);
  const mailbox = await mailpitResponse.json();
  const acknowledgement = mailbox.messages?.find(
    (message) => message.Subject === "We received your request"
  );
  if (!acknowledgement) throw new Error("Automatic acknowledgement was not delivered to Mailpit");
  if (lead.automationOwnershipState !== "HUMAN_ACTIVE") {
    throw new Error("Automatic acknowledgement incorrectly activated AI");
  }
  if (!activities.some((activity) => activity.type === "MESSAGE_SENT")) {
    throw new Error("Acknowledgement is missing from the activity timeline");
  }
  if (!conversations.some((conversation) => conversation.mode === "HUMAN")) {
    throw new Error("Acknowledgement conversation is not owned by the manager");
  }

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Conversation`);
  await page.getByRole("heading", { name: "AI follow-up" }).waitFor();
  await page.getByText("We have received your request", { exact: false }).waitFor();
  await page.waitForTimeout(500);
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible:
      /HUMAN_ACTIVE|HUMAN_ACTION_COMPLETED|AI_ACTIVE|AI_STOPPED|HUMAN_REQUIRED/u.test(
        document.body.innerText
      )
  }));
  if (pageCheck.horizontalOverflow) throw new Error("Conversation screen has horizontal overflow");
  if (pageCheck.rawStateVisible)
    throw new Error("Conversation screen exposes a raw ownership state");
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  const screenshot = path.join(outputDir, "02-acknowledgement-human-owned.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify({ ...state, acknowledgementVerifiedAt: new Date().toISOString() }, null, 2)
  );
  process.stdout.write(
    JSON.stringify({
      step: 2,
      leadId: state.leadId,
      acknowledgementCount: mailbox.count,
      ownership: lead.automationOwnershipState,
      screenshot,
      pageCheck
    })
  );
}

async function verifyManagerWork(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1 and 2 before step 3");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const [lead, tasks] = await Promise.all([
    apiGet(`/api/leads/${state.leadId}`, auth.accessToken),
    apiGet(`/api/tasks?leadId=${state.leadId}`, auth.accessToken)
  ]);
  const openTasks = tasks.filter((task) => task.status !== "COMPLETED");
  if (lead.owner?.email !== auth.user.email) throw new Error("Lead is not assigned to the manager");
  if (lead.automationOwnershipState !== "HUMAN_ACTIVE") {
    throw new Error(`Manager step has unexpected ownership ${lead.automationOwnershipState}`);
  }
  if (openTasks.length !== 1) {
    throw new Error(`Expected one clear open task, found ${openTasks.length}`);
  }
  if (openTasks[0].title !== lead.nextAction) {
    throw new Error(`Task and lead next action differ: ${openTasks[0].title} / ${lead.nextAction}`);
  }

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Tasks`);
  await page.getByRole("heading", { name: "Lead work" }).waitFor();
  await page.getByRole("article").getByText(lead.nextAction, { exact: true }).waitFor();
  await page.getByText("Handled by you", { exact: true }).waitFor();
  await page.waitForTimeout(500);
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible:
      /HUMAN_ACTIVE|HUMAN_ACTION_COMPLETED|AI_ACTIVE|AI_STOPPED|HUMAN_REQUIRED/u.test(
        document.body.innerText
      )
  }));
  if (pageCheck.horizontalOverflow) throw new Error("Manager task screen has horizontal overflow");
  if (pageCheck.rawStateVisible)
    throw new Error("Manager task screen exposes a raw ownership state");
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  const screenshot = path.join(outputDir, "03-manager-task.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify({ ...state, managerWorkVerifiedAt: new Date().toISOString() }, null, 2)
  );
  process.stdout.write(
    JSON.stringify({
      step: 3,
      leadId: state.leadId,
      owner: `${lead.owner.firstName} ${lead.owner.lastName}`,
      nextAction: lead.nextAction,
      openTaskCount: openTasks.length,
      screenshot,
      pageCheck
    })
  );
}

async function sendSubstantiveHumanResponse(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1-3 before step 4");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const subject = "Aurevia CRM discovery and rollout";
  const body = `Hi Rhea,\n\nThank you for your inquiry. I reviewed the requirements for your 25-person sales team. Please confirm your current CRM, monthly lead volume, migration record count, and a suitable time next week for a 30-minute discovery call. Pricing, discounts, legal terms, and delivery commitments remain subject to human approval.\n\nRegards,\nDevelopment Admin`;
  const before = await apiGet(`/api/leads/${state.leadId}`, auth.accessToken);
  const activitiesBefore = await apiGet(`/api/leads/${state.leadId}/activities`, auth.accessToken);
  const alreadySent = activitiesBefore.some(
    (activity) => activity.type === "MESSAGE_SENT" && activity.description.includes(subject)
  );
  if (
    before.automationOwnershipState !== "HUMAN_ACTIVE" &&
    !(before.automationOwnershipState === "AI_ACTIVE" && alreadySent)
  ) {
    throw new Error(`Step 4 must begin in HUMAN_ACTIVE, found ${before.automationOwnershipState}`);
  }

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  if (!alreadySent) {
    await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Overview`);
    await page.getByRole("button", { name: "Email", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Send email" });
    await dialog.getByLabel("Subject").fill(subject);
    await dialog.getByLabel("Message").fill(body);
    await dialog.getByRole("button", { name: "Send email", exact: true }).click();
    await dialog.waitFor({ state: "detached", timeout: 45000 });
  }

  const lead = await waitForApi(async () => {
    const value = await apiGet(`/api/leads/${state.leadId}`, auth.accessToken);
    return value.automationOwnershipState === "AI_ACTIVE" ? value : null;
  });
  const [activities, followUps, tasks] = await Promise.all([
    apiGet(`/api/leads/${state.leadId}/activities`, auth.accessToken),
    apiGet(`/api/followups/leads/${state.leadId}`, auth.accessToken),
    apiGet(`/api/tasks?leadId=${state.leadId}`, auth.accessToken)
  ]);
  const ownershipChanges = activities.filter(
    (activity) => activity.type === "AUTOMATION_OWNERSHIP_CHANGED"
  );
  const transitionText = ownershipChanges.map((activity) => activity.description).join(" | ");
  if (!transitionText.includes("HUMAN_ACTION_COMPLETED") || !transitionText.includes("AI_ACTIVE")) {
    throw new Error("The human action handoff sequence was not persisted completely");
  }
  if (!followUps.some((sequence) => sequence.status === "ACTIVE")) {
    throw new Error("AI follow-up sequence did not become active");
  }
  if (
    !activities.some(
      (activity) => activity.type === "MESSAGE_SENT" && activity.description.includes(subject)
    )
  ) {
    throw new Error("Substantive human email is missing from activity history");
  }

  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Conversation`);
  await page.getByText("AI following up", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "AI follow-up" }).waitFor();
  await page.getByText(body, { exact: true }).waitFor();
  await page.waitForTimeout(700);
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible:
      /HUMAN_ACTIVE|HUMAN_ACTION_COMPLETED|AI_ACTIVE|AI_STOPPED|HUMAN_REQUIRED/u.test(
        document.body.innerText
      )
  }));
  if (pageCheck.horizontalOverflow) throw new Error("Human handoff screen has horizontal overflow");
  if (pageCheck.rawStateVisible)
    throw new Error("Human handoff screen exposes a raw ownership state");
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  const screenshot = path.join(outputDir, "04-human-response-ai-handoff.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        ...state,
        humanEmail: { subject, body },
        humanResponseVerifiedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 4,
      leadId: state.leadId,
      ownership: lead.automationOwnershipState,
      activeFollowUps: followUps.filter((sequence) => sequence.status === "ACTIVE").length,
      openTasks: tasks.filter((task) => task.status !== "COMPLETED").length,
      screenshot,
      pageCheck
    })
  );
}

async function verifyAiFollowUp(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1-4 before step 5");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const [lead, sequences, conversations] = await Promise.all([
    apiGet(`/api/leads/${state.leadId}`, auth.accessToken),
    apiGet(`/api/followups/leads/${state.leadId}`, auth.accessToken),
    apiGet(`/api/conversations?leadId=${state.leadId}`, auth.accessToken)
  ]);
  let sequence = sequences[0];
  if (!sequence || !["ACTIVE", "COMPLETED"].includes(sequence.status)) {
    throw new Error(`AI follow-up is not healthy: ${sequence?.status ?? "missing"}`);
  }
  if (lead.automationOwnershipState !== "AI_ACTIVE") {
    throw new Error(`AI does not own the next action: ${lead.automationOwnershipState}`);
  }
  if (
    new Set(sequence.attempts.map((attempt) => attempt.idempotencyKey)).size !==
    sequence.attempts.length
  ) {
    throw new Error("Follow-up attempts contain duplicate idempotency keys");
  }
  if (
    sequence.status === "ACTIVE" &&
    sequence.attempts.length > 0 &&
    sequence.attempts.every((attempt) => attempt.status === "SENT")
  ) {
    const finalAttempt = sequence.attempts.at(-1);
    const events = await apiGet(
      `/api/domain-events?aggregateType=FollowUpAttempt&aggregateId=${finalAttempt.id}&limit=10`,
      auth.accessToken
    );
    const retryable = events.items?.find((event) =>
      ["FAILED", "ATTENTION_REQUIRED"].includes(event.status)
    );
    if (retryable) {
      await apiPost(`/api/domain-events/${retryable.id}/retry`, auth.accessToken);
    }
    sequence = await waitForApi(async () => {
      const refreshed = await apiGet(`/api/followups/leads/${state.leadId}`, auth.accessToken);
      return refreshed[0]?.status === "COMPLETED" ? refreshed[0] : null;
    }, 60000);
  }
  const conversation = conversations.find((item) => item.id === sequence.conversationId);
  if (!conversation) throw new Error("AI follow-up conversation is missing");
  const messages = await apiGet(`/api/conversations/${conversation.id}/messages`, auth.accessToken);
  const humanMessageIndex = messages.findIndex(
    (message) =>
      message.senderType === "USER" && message.body.includes("Thank you for your inquiry")
  );
  if (humanMessageIndex < 0) throw new Error("Substantive human response is missing");
  const messagesAfterHumanResponse = messages.slice(humanMessageIndex + 1);
  if (messagesAfterHumanResponse.some((message) => message.direction === "INBOUND")) {
    throw new Error("A customer reply appeared without an inbound provider event");
  }
  const contactName = `${lead.contact.firstName} ${lead.contact.lastName}`.toLocaleLowerCase();
  const aiMessages = messagesAfterHumanResponse.filter((item) => item.senderType === "AI");
  if (!aiMessages.length) throw new Error("Follow-up messages do not identify their AI sender");
  for (const message of aiMessages) {
    const normalized = message.body.toLocaleLowerCase();
    const signOff = Math.max(
      normalized.lastIndexOf("best regards"),
      normalized.lastIndexOf("regards")
    );
    if ((signOff >= 0 ? normalized.slice(signOff) : normalized.slice(-120)).includes(contactName)) {
      throw new Error("An AI follow-up impersonated the customer");
    }
  }

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Conversation`);
  await page.getByText("AI following up", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "AI follow-up" }).waitFor();
  await page.getByText("You", { exact: true }).waitFor();
  await page.getByText("Automated message", { exact: true }).first().waitFor();
  if (sequence.status === "ACTIVE") {
    const pending = sequence.attempts.find((attempt) =>
      ["SCHEDULED", "SENDING"].includes(attempt.status)
    );
    if (pending) {
      const expectedAction =
        pending.stepIndex === 0
          ? "Send first follow-up email"
          : `Send follow-up email ${String(pending.stepIndex + 1)}`;
      const count = await page.getByText(expectedAction, { exact: false }).count();
      if (count < 2) throw new Error("Lead header and follow-up panel do not show the same action");
    }
  }
  await page.waitForTimeout(500);
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible:
      /HUMAN_ACTIVE|HUMAN_ACTION_COMPLETED|AI_ACTIVE|AI_STOPPED|HUMAN_REQUIRED/u.test(
        document.body.innerText
      )
  }));
  if (pageCheck.horizontalOverflow) throw new Error("AI follow-up screen has horizontal overflow");
  if (pageCheck.rawStateVisible)
    throw new Error("AI follow-up screen exposes a raw ownership state");
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  const screenshot = path.join(outputDir, "05-ai-follow-up.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify({ ...state, aiFollowUpVerifiedAt: new Date().toISOString() }, null, 2)
  );
  process.stdout.write(
    JSON.stringify({
      step: 5,
      leadId: state.leadId,
      ownership: lead.automationOwnershipState,
      sequenceStatus: sequence.status,
      attempts: sequence.attempts.map((attempt) => ({
        step: attempt.stepIndex,
        status: attempt.status,
        scheduledAt: attempt.scheduledAt
      })),
      screenshot,
      pageCheck
    })
  );
}

async function verifyWorkflowBuilder(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1-5 before step 6");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const [dashboard, agents] = await Promise.all([
    apiGet("/api/workflows", auth.accessToken),
    apiGet("/api/agents", auth.accessToken)
  ]);
  const workflow = dashboard.workflows.find((item) => item.name === "Priority lead follow-up");
  const outreach = agents.agents.find((item) => item.name === "Outreach Agent");
  if (!workflow || !outreach) throw new Error("Persisted workflow or Outreach Agent is missing");

  const definition = {
    schemaVersion: 1,
    kind: "WORKFLOW",
    nodes: [
      {
        id: "human-finished",
        type: "TRIGGER",
        label: "Human response completed",
        position: { x: 330, y: 40 },
        config: { event: "HUMAN_ACTION_COMPLETED" }
      },
      {
        id: "customer-replied",
        type: "CONDITION",
        label: "Has the customer replied?",
        position: { x: 330, y: 175 },
        config: { field: "meaningfulReply", value: "true" }
      },
      {
        id: "wait",
        type: "WAIT",
        label: "Wait for the next follow-up",
        position: { x: 40, y: 330 },
        config: { cadenceIndex: 0 }
      },
      {
        id: "outreach-agent",
        type: "AGENT_INVOKE",
        label: "Prepare a grounded follow-up",
        position: { x: 40, y: 465 },
        config: { agentId: outreach.id }
      },
      {
        id: "send-follow-up",
        type: "COMMUNICATION",
        label: "Send the approved follow-up",
        position: { x: 40, y: 600 },
        config: {
          channel: "EMAIL",
          subject: "Following up on your CRM requirements",
          message:
            "Follow up using the approved lead context. Do not offer pricing, discounts, legal terms, or delivery commitments."
        }
      },
      {
        id: "high-risk",
        type: "CONDITION",
        label: "Does this need human judgment?",
        position: { x: 330, y: 735 },
        config: { field: "requiresHuman", value: "true" }
      },
      {
        id: "keep-following",
        type: "CRM_ACTION",
        label: "Continue safe follow-up",
        position: { x: 40, y: 890 },
        config: { action: "FOLLOW_UP" }
      },
      {
        id: "human-handoff",
        type: "HUMAN_APPROVAL",
        label: "Hand back to the salesperson",
        position: { x: 420, y: 330 },
        config: {
          reason:
            "The customer replied or requested pricing, discounts, legal terms, or a commitment."
        }
      },
      {
        id: "manager-task",
        type: "TASK",
        label: "Create the manager's response task",
        position: { x: 420, y: 500 },
        config: { title: "Review the customer reply and respond", dueMinutes: 30, priority: "HIGH" }
      },
      {
        id: "complete",
        type: "END",
        label: "Follow-up complete",
        position: { x: 330, y: 1040 },
        config: { outcome: "COMPLETED" }
      }
    ],
    edges: [
      { id: "e1", source: "human-finished", target: "customer-replied", branch: null },
      { id: "e2", source: "customer-replied", target: "human-handoff", branch: "Yes" },
      { id: "e3", source: "customer-replied", target: "wait", branch: "No" },
      { id: "e4", source: "wait", target: "outreach-agent", branch: null },
      { id: "e5", source: "outreach-agent", target: "send-follow-up", branch: null },
      { id: "e6", source: "send-follow-up", target: "high-risk", branch: null },
      { id: "e7", source: "high-risk", target: "human-handoff", branch: "Yes" },
      { id: "e8", source: "high-risk", target: "keep-following", branch: "No" },
      { id: "e9", source: "human-handoff", target: "manager-task", branch: null },
      { id: "e10", source: "manager-task", target: "complete", branch: null },
      { id: "e11", source: "keep-following", target: "complete", branch: null }
    ]
  };
  await apiPut(`/api/workflows/${workflow.id}/draft`, auth.accessToken, {
    definition,
    policyConfig: {
      service: "Connected CRM implementation and AI sales follow-up",
      source: "Website",
      priority: "NORMAL",
      cadenceMinutes: [2880, 7200, 11520]
    }
  });
  const validation = await apiPost(`/api/workflows/${workflow.id}/validate`, auth.accessToken);
  if (!validation.valid)
    throw new Error(`Workflow is invalid: ${JSON.stringify(validation.issues)}`);

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/workflows/${workflow.id}?tab=builder`);
  await page.getByRole("heading", { name: "Workflow Builder" }).waitFor();
  for (const label of [
    "Trigger",
    "Condition",
    "If / Else",
    "Wait",
    "Action",
    "Agent",
    "Handoff",
    "End"
  ]) {
    await page
      .getByRole("button", { name: new RegExp(`^${label}`) })
      .first()
      .waitFor();
  }
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await page.getByText("Workflow is valid", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByText("Steps that will run", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to inspector", exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const published = await waitForApi(async () => {
    const item = await apiGet(`/api/workflows/${workflow.id}`, auth.accessToken);
    return item.status === "PUBLISHED" &&
      item.currentVersion?.definition.nodes.length === definition.nodes.length
      ? item
      : null;
  });
  await page.getByText("PUBLISHED", { exact: true }).first().waitFor();
  await page.waitForTimeout(500);
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    nodeCount: document.querySelectorAll(".composer-node").length,
    connectorCount: document.querySelectorAll(".composer-connectors path").length,
    inspectorVisible: Boolean(document.querySelector(".composer-inspector"))
  }));
  if (pageCheck.horizontalOverflow) throw new Error("Workflow builder has horizontal overflow");
  if (
    pageCheck.nodeCount !== definition.nodes.length ||
    pageCheck.connectorCount !== definition.edges.length ||
    !pageCheck.inspectorVisible
  ) {
    throw new Error(`Workflow builder is incomplete: ${JSON.stringify(pageCheck)}`);
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  const screenshot = path.join(outputDir, "06-workflow-builder.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      { ...state, workflowId: workflow.id, workflowVerifiedAt: new Date().toISOString() },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 6,
      workflowId: workflow.id,
      status: published.status,
      version: published.currentVersion.version,
      screenshot,
      pageCheck
    })
  );
}

async function verifyAgentComposer(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1-6 before step 7");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const dashboard = await apiGet("/api/agents", auth.accessToken);
  const agent = dashboard.agents.find((item) => item.name === "Outreach Agent");
  if (!agent) throw new Error("Outreach Agent is missing");
  const definition = {
    schemaVersion: 1,
    kind: "AGENT_COMPOSER",
    nodes: [
      {
        id: "start",
        type: "TRIGGER",
        label: "Human response is complete",
        position: { x: 160, y: 30 },
        config: { event: "The salesperson has sent a meaningful response" }
      },
      {
        id: "context-message",
        type: "MESSAGE",
        label: "Use the complete CRM context",
        position: { x: 160, y: 150 },
        config: {
          message:
            "Use the lead, company, conversation, qualification, meeting, proposal, and approved document context."
        }
      },
      {
        id: "reply-question",
        type: "QUESTION",
        label: "Check for a customer reply",
        position: { x: 160, y: 270 },
        config: {
          question: "Has the customer sent a meaningful reply since the salesperson responded?"
        }
      },
      {
        id: "reply-condition",
        type: "CONDITION",
        label: "AI may continue?",
        position: { x: 160, y: 390 },
        config: { expression: "lead.automationOwnershipState == AI_ACTIVE" }
      },
      {
        id: "safe-decision",
        type: "AI_DECISION",
        label: "Choose the safe next step",
        position: { x: 20, y: 530 },
        config: {
          instruction:
            "Follow up only from grounded CRM context. Ask a person for pricing, discounts, legal terms, commitments, complaints, refunds, or sensitive requests."
        }
      },
      {
        id: "follow-up-action",
        type: "TOOL_CRM_ACTION",
        label: "Record the follow-up task",
        position: { x: 20, y: 690 },
        config: { capability: "create-task", title: "Review the prepared follow-up" }
      },
      {
        id: "email-action",
        type: "INTEGRATION_ACTION",
        label: "Send through the connected channel",
        position: { x: 20, y: 830 },
        config: { capability: "email", subject: "Following up on your CRM requirements" }
      },
      {
        id: "human-handoff",
        type: "HUMAN_HANDOFF",
        label: "Return work to the salesperson",
        position: { x: 300, y: 530 },
        config: { reason: "The customer replied or the request needs human judgment." }
      },
      {
        id: "safe-end",
        type: "END",
        label: "Follow-up recorded",
        position: { x: 20, y: 980 },
        config: { outcome: "Safe follow-up completed and recorded" }
      },
      {
        id: "human-end",
        type: "END",
        label: "Human response required",
        position: { x: 300, y: 700 },
        config: { outcome: "Automation stopped and the salesperson was notified" }
      }
    ],
    edges: [
      { id: "a1", source: "start", target: "context-message", branch: null },
      { id: "a2", source: "context-message", target: "reply-question", branch: null },
      { id: "a3", source: "reply-question", target: "reply-condition", branch: null },
      { id: "a4", source: "reply-condition", target: "safe-decision", branch: "true" },
      { id: "a5", source: "reply-condition", target: "human-handoff", branch: "false" },
      { id: "a6", source: "safe-decision", target: "follow-up-action", branch: "Safe follow-up" },
      { id: "a7", source: "safe-decision", target: "human-handoff", branch: "Needs a person" },
      { id: "a8", source: "follow-up-action", target: "email-action", branch: null },
      { id: "a9", source: "email-action", target: "safe-end", branch: null },
      { id: "a10", source: "human-handoff", target: "human-end", branch: null }
    ]
  };
  await apiPut(`/api/agents/${agent.id}/composer`, auth.accessToken, { definition });
  const validation = await apiPost(`/api/agents/${agent.id}/composer/validate`, auth.accessToken);
  if (!validation.valid)
    throw new Error(`Agent Composer is invalid: ${JSON.stringify(validation.issues)}`);

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/agents/${agent.id}?tab=composer`);
  await page.getByRole("heading", { name: "Visual behavior" }).waitFor();
  for (const label of [
    "Trigger",
    "Message",
    "Question",
    "Condition",
    "Action",
    "Integration",
    "End"
  ]) {
    await page
      .getByRole("button", { name: new RegExp(`^${label}`) })
      .first()
      .waitFor();
  }
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await page.getByText("Flow is valid", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByText("Steps that will run", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to inspector", exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const published = await waitForApi(async () => {
    const item = await apiGet(`/api/agents/${agent.id}`, auth.accessToken);
    return item.draftVersionId === null &&
      item.currentVersion?.definition.nodes?.length === definition.nodes.length
      ? item
      : null;
  });
  await page.getByText("PUBLISHED", { exact: true }).first().waitFor();
  await page.waitForTimeout(500);
  const composerCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    nodeCount: document.querySelectorAll(".composer-node").length,
    connectorCount: document.querySelectorAll(".composer-connectors path").length,
    inspectorVisible: Boolean(document.querySelector(".composer-inspector"))
  }));
  if (
    composerCheck.horizontalOverflow ||
    composerCheck.nodeCount !== definition.nodes.length ||
    composerCheck.connectorCount !== definition.edges.length ||
    !composerCheck.inspectorVisible
  ) {
    throw new Error(`Agent Composer is incomplete: ${JSON.stringify(composerCheck)}`);
  }
  const composerScreenshot = path.join(outputDir, "07a-agent-composer.png");
  await page.screenshot({ path: composerScreenshot, fullPage: true });

  await page.goto(`${baseUrl}/agents/${agent.id}?tab=executions`);
  await page.getByRole("button", { name: /Executions/u }).waitFor();
  await page
    .getByText(/Outreach (sent|cancelled)/u)
    .first()
    .waitFor();
  await page.waitForTimeout(400);
  const executionsScreenshot = path.join(outputDir, "07b-agent-executions.png");
  await page.screenshot({ path: executionsScreenshot, fullPage: true });

  await page.goto(`${baseUrl}/agents/${agent.id}?tab=evaluation`);
  await page.getByRole("heading", { name: "Run schedule and outcomes" }).waitFor();
  await page.getByRole("heading", { name: /^(Latest governed run|Next scheduled run)$/u }).waitFor();
  await page.waitForTimeout(400);
  const evaluationScreenshot = path.join(outputDir, "07c-agent-evaluation.png");
  await page.screenshot({ path: evaluationScreenshot, fullPage: true });
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      { ...state, outreachAgentId: agent.id, agentVerifiedAt: new Date().toISOString() },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 7,
      agentId: agent.id,
      status: published.status,
      version: published.currentVersion.version,
      executions: published.executions.length,
      screenshots: [composerScreenshot, executionsScreenshot, evaluationScreenshot],
      composerCheck
    })
  );
}

async function receiveMeaningfulCustomerReply(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1-7 before step 8");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const reply = `Hi Development Admin,\n\nWe currently use Zoho Bigin and spreadsheets. We receive about 600 leads each month and need to migrate around 15,000 contacts. Tuesday at 11:00 AM IST works for a 30-minute discovery call.\n\nPlease also share your best price, confirm a 25% discount, and guarantee the February 2027 delivery date.\n\nRegards,\nRhea Malhotra`;
  const beforeLead = await apiGet(`/api/leads/${state.leadId}`, auth.accessToken);
  if (!["AI_ACTIVE", "HUMAN_REQUIRED"].includes(beforeLead.automationOwnershipState)) {
    throw new Error(
      `Step 8 must begin with AI follow-up active, found ${beforeLead.automationOwnershipState}`
    );
  }
  const conversationsBefore = await apiGet(
    `/api/conversations?leadId=${state.leadId}`,
    auth.accessToken
  );
  const messageListsBefore = await Promise.all(
    conversationsBefore.map((conversation) =>
      apiGet(`/api/conversations/${conversation.id}/messages`, auth.accessToken)
    )
  );
  const messagesBefore = messageListsBefore.flat();
  const alreadyReceived = messagesBefore.some(
    (message) => message.direction === "INBOUND" && message.body === reply
  );
  if (beforeLead.automationOwnershipState === "HUMAN_REQUIRED" && !alreadyReceived) {
    throw new Error("Step 8 found human ownership without the expected customer reply");
  }

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Conversation`);
  await page.getByRole("heading", { name: "AI follow-up" }).waitFor();
  if (!alreadyReceived) {
    const replyPanel = page.getByRole("region", { name: "Test customer reply" });
    await replyPanel.getByLabel("Test customer reply").fill(reply);
    const replyResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/email/e2e/customer-reply")
    );
    await replyPanel.getByRole("button", { name: "Receive customer reply" }).click();
    const replyResponse = await replyResponsePromise;
    if (!replyResponse.ok()) {
      throw new Error(
        `Customer reply ingestion failed (${String(replyResponse.status())}): ${await replyResponse.text()}; request=${replyResponse.request().postData() ?? "missing"}`
      );
    }
  }
  await page.getByText("Needs your response", { exact: true }).waitFor({ timeout: 45000 });
  await page.getByRole("heading", { name: "Reply to customer" }).waitFor();
  await page
    .getByRole("region", { name: "Conversation thread" })
    .getByText("We currently use Zoho Bigin", { exact: false })
    .waitFor();

  const synchronizedReplyState = await waitForApi(async () => {
    const [value, currentTasks] = await Promise.all([
      apiGet(`/api/leads/${state.leadId}`, auth.accessToken),
      apiGet(`/api/tasks?leadId=${state.leadId}`, auth.accessToken)
    ]);
    const openTasks = currentTasks.filter((task) => task.status !== "COMPLETED");
    return value.automationOwnershipState === "HUMAN_REQUIRED" &&
      openTasks.length === 1 &&
      openTasks[0].title === value.nextAction
      ? { lead: value, tasks: currentTasks }
      : null;
  }, 45000);
  const { lead, tasks } = synchronizedReplyState;
  const [activities, followUps, conversationsAfter] = await Promise.all([
    apiGet(`/api/leads/${state.leadId}/activities`, auth.accessToken),
    apiGet(`/api/followups/leads/${state.leadId}`, auth.accessToken),
    apiGet(`/api/conversations?leadId=${state.leadId}`, auth.accessToken)
  ]);
  const transitions = activities
    .filter((activity) => activity.type === "AUTOMATION_OWNERSHIP_CHANGED")
    .map((activity) => activity.description)
    .join(" | ");
  if (!transitions.includes("AI_STOPPED") || !transitions.includes("HUMAN_REQUIRED")) {
    throw new Error("Customer reply did not persist the complete AI stop and human handoff");
  }
  if (followUps.some((sequence) => sequence.status === "ACTIVE")) {
    throw new Error("An AI follow-up sequence remained active after the customer reply");
  }
  const openReplyTasks = tasks.filter((task) => task.status !== "COMPLETED");
  if (openReplyTasks.length !== 1) {
    throw new Error(`Expected one clear customer-response task, found ${openReplyTasks.length}`);
  }
  if (openReplyTasks[0].title !== lead.nextAction) {
    throw new Error(
      `Customer-response task and next action differ: ${openReplyTasks[0].title} / ${lead.nextAction}`
    );
  }
  await page.waitForTimeout(1200);
  const messageListsAfter = await Promise.all(
    conversationsAfter.map((conversation) =>
      apiGet(`/api/conversations/${conversation.id}/messages`, auth.accessToken)
    )
  );
  const allMessagesAfter = messageListsAfter.flat();
  const persistedReply = allMessagesAfter.find(
    (message) => message.direction === "INBOUND" && message.body === reply
  );
  if (!persistedReply) {
    throw new Error("The signed inbound customer reply is missing from the conversation history");
  }
  const replyReceivedAt = Date.parse(persistedReply.createdAt);
  const outboundAfterReply = allMessagesAfter.filter(
    (message) =>
      message.direction === "OUTBOUND" && Date.parse(message.createdAt) > replyReceivedAt
  );
  if (outboundAfterReply.length > 0) {
    throw new Error(
      "An outbound message was sent automatically after the meaningful customer reply"
    );
  }
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible:
      /HUMAN_ACTIVE|HUMAN_ACTION_COMPLETED|AI_ACTIVE|AI_STOPPED|HUMAN_REQUIRED/u.test(
        document.body.innerText
      ),
    rawReasonVisible:
      /MEANINGFUL_CLIENT_REPLY|INBOUND_REPLY_RECEIVED|DO_NOT_CONTACT|MANUAL_PAUSE/u.test(
        document.body.innerText
      ),
    customerReplyVisible: document.body.innerText.includes("We currently use Zoho Bigin"),
    humanReplyVisible: document.body.innerText.includes("Reply to customer")
  }));
  if (pageCheck.horizontalOverflow)
    throw new Error("Customer reply screen has horizontal overflow");
  if (pageCheck.rawStateVisible)
    throw new Error("Customer reply screen exposes a raw ownership state");
  if (pageCheck.rawReasonVisible)
    throw new Error("Customer reply screen exposes a raw automation reason");
  if (!pageCheck.customerReplyVisible || !pageCheck.humanReplyVisible) {
    throw new Error(`Customer handoff UI is incomplete: ${JSON.stringify(pageCheck)}`);
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  const screenshot = path.join(outputDir, "08-customer-reply-human-required.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      { ...state, customerReply: reply, customerReplyVerifiedAt: new Date().toISOString() },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 8,
      leadId: state.leadId,
      ownership: lead.automationOwnershipState,
      openReplyTask: openReplyTasks[0].title,
      activeFollowUps: followUps.filter((sequence) => sequence.status === "ACTIVE").length,
      outboundTotal: allMessagesAfter.filter((message) => message.direction === "OUTBOUND").length,
      outboundAfterReply: outboundAfterReply.length,
      screenshot,
      pageCheck
    })
  );
}

async function verifyReplyClassification(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1-8 before step 9");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const [lead, qualification, activities, tasks] = await Promise.all([
    apiGet(`/api/leads/${state.leadId}`, auth.accessToken),
    apiGet(`/api/leads/${state.leadId}/qualification`, auth.accessToken),
    apiGet(`/api/leads/${state.leadId}/activities`, auth.accessToken),
    apiGet(`/api/tasks?leadId=${state.leadId}`, auth.accessToken)
  ]);
  if (lead.automationOwnershipState !== "HUMAN_REQUIRED") {
    throw new Error(
      `Reply classification released human ownership: ${lead.automationOwnershipState}`
    );
  }
  if (!activities.some((activity) => activity.type === "NEGOTIATION_HANDOFF")) {
    throw new Error("Pricing and discount language was not escalated as a negotiation");
  }
  const evidence = qualification.evidence.map((item) => item.quote).join(" ");
  for (const expected of [
    "Zoho Bigin",
    "600 leads",
    "15,000 contacts",
    "Tuesday at 11:00 AM IST"
  ]) {
    if (!evidence.includes(expected))
      throw new Error(`Qualification evidence is missing: ${expected}`);
  }
  if (
    qualification.budget ||
    qualification.authority ||
    qualification.decisionMakerIdentified !== null
  ) {
    throw new Error("Qualification invented budget, authority, or decision-maker evidence");
  }
  if (!qualification.timeline?.includes("February 2027")) {
    throw new Error(
      `Qualification timeline is not grounded: ${qualification.timeline ?? "missing"}`
    );
  }
  const openTasks = tasks.filter((task) => task.status !== "COMPLETED");
  if (openTasks.length !== 1 || openTasks[0].title !== lead.nextAction) {
    throw new Error("Reply classification did not leave one synchronized manager action");
  }

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Qualification`);
  await page.getByRole("heading", { name: "Qualification signals" }).waitFor();
  await page.getByText("Zoho Bigin", { exact: false }).first().waitFor();
  await page.getByText("February 2027", { exact: false }).first().waitFor();
  await page.getByText("Budget unknown", { exact: true }).waitFor();
  await page.getByText("Authority unknown", { exact: true }).waitFor();
  await page.waitForTimeout(500);
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible:
      /HUMAN_ACTIVE|HUMAN_ACTION_COMPLETED|AI_ACTIVE|AI_STOPPED|HUMAN_REQUIRED/u.test(
        document.body.innerText
      ),
    evidenceVisible:
      document.body.innerText.includes("600 leads") &&
      document.body.innerText.includes("15,000 contacts"),
    unknownsVisible:
      document.body.innerText.includes("Budget unknown") &&
      document.body.innerText.includes("Authority unknown")
  }));
  if (pageCheck.horizontalOverflow) throw new Error("Qualification screen has horizontal overflow");
  if (pageCheck.rawStateVisible)
    throw new Error("Qualification screen exposes a raw ownership state");
  if (!pageCheck.evidenceVisible || !pageCheck.unknownsVisible) {
    throw new Error(`Qualification UI is incomplete: ${JSON.stringify(pageCheck)}`);
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  const screenshot = path.join(outputDir, "09-reply-classification.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify({ ...state, replyClassificationVerifiedAt: new Date().toISOString() }, null, 2)
  );
  process.stdout.write(
    JSON.stringify({
      step: 9,
      leadId: state.leadId,
      classification: "Negotiation / human review",
      score: lead.score,
      temperature: lead.temperature,
      nextAction: lead.nextAction,
      screenshot,
      pageCheck
    })
  );
}

async function sendSafeHumanNegotiationResponse(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1-9 before step 10");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const reply = `Hi Rhea,\n\nThank you for confirming your current setup, migration volume, and availability. Tuesday at 11:00 AM IST works for the discovery discussion. We can review scope, pricing, and delivery planning during that call. I cannot approve a 25% discount or guarantee the February 2027 delivery date in this email; both require internal review and written approval.\n\nRegards,\nDevelopment Admin`;
  const beforeLead = await apiGet(`/api/leads/${state.leadId}`, auth.accessToken);
  const conversationsBefore = await apiGet(
    `/api/conversations?leadId=${state.leadId}`,
    auth.accessToken
  );
  const messageListsBefore = await Promise.all(
    conversationsBefore.map((conversation) =>
      apiGet(`/api/conversations/${conversation.id}/messages`, auth.accessToken)
    )
  );
  const alreadySent = messageListsBefore
    .flat()
    .some((message) => message.senderType === "USER" && message.body === reply);
  if (!["HUMAN_REQUIRED", "AI_ACTIVE"].includes(beforeLead.automationOwnershipState)) {
    throw new Error(
      `Step 10 must begin with human action required, found ${beforeLead.automationOwnershipState}`
    );
  }
  if (beforeLead.automationOwnershipState === "AI_ACTIVE" && !alreadySent) {
    throw new Error("Step 10 found AI ownership without the expected human pricing response");
  }
  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Conversation`);
  if (!alreadySent) {
    await page.getByRole("heading", { name: "Reply to customer" }).waitFor();
    const acknowledge = page.getByRole("button", { name: "Acknowledge", exact: true });
    if (await acknowledge.count()) {
      await acknowledge.first().click();
      await acknowledge.first().waitFor({ state: "detached" });
    }
    const replyPanel = page.getByRole("region", { name: "Human reply" });
    await replyPanel.getByLabel("Human reply").fill(reply);
    await replyPanel.getByRole("button", { name: "Send human reply" }).click();
  }
  await page.getByText("AI following up", { exact: true }).waitFor({ timeout: 45000 });

  const lead = await waitForApi(async () => {
    const value = await apiGet(`/api/leads/${state.leadId}`, auth.accessToken);
    return value.automationOwnershipState === "AI_ACTIVE" ? value : null;
  }, 45000);
  const activeSequence = await waitForApi(async () => {
    const sequences = await apiGet(`/api/followups/leads/${state.leadId}`, auth.accessToken);
    return sequences.find((sequence) => sequence.status === "ACTIVE") ?? null;
  }, 45000);
  const [activities, followUps, notifications, conversations] = await Promise.all([
    apiGet(`/api/leads/${state.leadId}/activities`, auth.accessToken),
    apiGet(`/api/followups/leads/${state.leadId}`, auth.accessToken),
    apiGet(`/api/notifications?leadId=${state.leadId}&limit=20`, auth.accessToken),
    apiGet(`/api/conversations?leadId=${state.leadId}`, auth.accessToken)
  ]);
  const transitionText = activities
    .filter((activity) => activity.type === "AUTOMATION_OWNERSHIP_CHANGED")
    .map((activity) => activity.description)
    .join(" | ");
  if (
    !transitionText.includes("HUMAN_REQUIRED to HUMAN_ACTION_COMPLETED") ||
    !transitionText.includes("HUMAN_ACTION_COMPLETED to AI_ACTIVE")
  ) {
    throw new Error("The human response did not persist the complete hand-back to AI");
  }
  if (!activities.some((activity) => activity.title === "Negotiation handoff resolved")) {
    throw new Error("The human pricing response did not resolve the negotiation handoff");
  }
  const negotiationNotification = notifications.find(
    (notification) => notification.type === "NEGOTIATION_HANDOFF"
  );
  if (
    !negotiationNotification ||
    negotiationNotification.status !== "ACKNOWLEDGED" ||
    negotiationNotification.negotiationHandoff?.status !== "RESOLVED"
  ) {
    throw new Error("Negotiation notification and handoff are not synchronized as resolved");
  }
  if (!activeSequence) throw new Error("AI follow-up did not resume after the safe human response");
  const messageLists = await Promise.all(
    conversations.map((conversation) =>
      apiGet(`/api/conversations/${conversation.id}/messages`, auth.accessToken)
    )
  );
  const humanMessage = messageLists
    .flat()
    .find((message) => message.senderType === "USER" && message.body === reply);
  if (!humanMessage)
    throw new Error("The safe human response is missing from conversation history");
  if (!/cannot approve a 25% discount|require internal review/iu.test(humanMessage.body)) {
    throw new Error("The human response did not preserve pricing and commitment guardrails");
  }

  await page.getByText("I cannot approve a 25% discount", { exact: false }).waitFor();
  await page.waitForTimeout(700);
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible:
      /HUMAN_ACTIVE|HUMAN_ACTION_COMPLETED|AI_ACTIVE|AI_STOPPED|HUMAN_REQUIRED/u.test(
        document.body.innerText
      ),
    resumedVisible: document.body.innerText.includes("AI following up"),
    humanReplyVisible: document.body.innerText.includes("I cannot approve a 25% discount"),
    staleHandoffVisible: document.body.innerText.includes("Negotiation handoff required")
  }));
  if (pageCheck.horizontalOverflow)
    throw new Error("Human response screen has horizontal overflow");
  if (pageCheck.rawStateVisible)
    throw new Error("Human response screen exposes a raw ownership state");
  if (!pageCheck.resumedVisible || !pageCheck.humanReplyVisible || pageCheck.staleHandoffVisible) {
    throw new Error(`Human-to-AI resume UI is incomplete: ${JSON.stringify(pageCheck)}`);
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  const screenshot = path.join(outputDir, "10-human-response-ai-resumed.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      { ...state, negotiationReply: reply, humanResumeVerifiedAt: new Date().toISOString() },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 10,
      leadId: state.leadId,
      ownership: lead.automationOwnershipState,
      handoffStatus: negotiationNotification.negotiationHandoff.status,
      activeFollowUps: followUps.filter((sequence) => sequence.status === "ACTIVE").length,
      screenshot,
      pageCheck
    })
  );
}

async function verifyPersistedQualification(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1-10 before step 11");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const [lead, qualification, stages] = await Promise.all([
    apiGet(`/api/leads/${state.leadId}`, auth.accessToken),
    apiGet(`/api/leads/${state.leadId}/qualification`, auth.accessToken),
    apiGet("/api/pipeline/stages", auth.accessToken)
  ]);
  const evidence = qualification.evidence.map((item) => item.quote).join(" ");
  for (const expected of [
    "Zoho Bigin",
    "600 leads",
    "15,000 contacts",
    "Tuesday at 11:00 AM IST"
  ]) {
    if (!evidence.includes(expected))
      throw new Error(`Persisted qualification is missing: ${expected}`);
  }
  if (
    qualification.budget ||
    qualification.authority ||
    qualification.decisionMakerIdentified !== null
  ) {
    throw new Error("Qualification invented budget, authority, or decision-maker evidence");
  }
  if (!qualification.timeline?.includes("February 2027")) {
    throw new Error(
      `Qualification timeline is not grounded: ${qualification.timeline ?? "missing"}`
    );
  }
  if (!stages.some((stage) => stage.id === lead.stage.id)) {
    throw new Error("The lead stage is not part of the configured pipeline");
  }

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Qualification`);
  await page.getByRole("heading", { name: "Qualification signals" }).waitFor();
  await page.getByText("Budget unknown", { exact: true }).waitFor();
  await page.getByText("Authority unknown", { exact: true }).waitFor();
  await page.getByText("February 2027", { exact: false }).first().waitFor();
  await page.waitForTimeout(500);
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible:
      /HUMAN_ACTIVE|HUMAN_ACTION_COMPLETED|AI_ACTIVE|AI_STOPPED|HUMAN_REQUIRED/u.test(
        document.body.innerText
      ),
    evidenceVisible:
      document.body.innerText.includes("600 leads") &&
      document.body.innerText.includes("15,000 contacts") &&
      document.body.innerText.includes("Tuesday at 11:00 AM IST"),
    unknownsVisible:
      document.body.innerText.includes("Budget unknown") &&
      document.body.innerText.includes("Authority unknown"),
    currentStageVisible: document.body.innerText.includes("Negotiation")
  }));
  if (pageCheck.horizontalOverflow) throw new Error("Qualification screen has horizontal overflow");
  if (pageCheck.rawStateVisible)
    throw new Error("Qualification screen exposes a raw ownership state");
  if (!pageCheck.evidenceVisible || !pageCheck.unknownsVisible || !pageCheck.currentStageVisible) {
    throw new Error(`Qualification UI is incomplete: ${JSON.stringify(pageCheck)}`);
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  const screenshot = path.join(outputDir, "11-qualification.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify({ ...state, qualificationVerifiedAt: new Date().toISOString() }, null, 2)
  );
  process.stdout.write(
    JSON.stringify({
      step: 11,
      leadId: state.leadId,
      pipelineStage: lead.stage.label,
      qualifiedStageConfigured: stages.some((stage) => stage.label === "Qualified"),
      evidenceCount: qualification.evidence.length,
      screenshot,
      pageCheck
    })
  );
}

async function verifyLeadIntelligence(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1-11 before step 12");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  await apiPost(`/api/lead-intelligence/leads/${state.leadId}/refresh`, auth.accessToken, {});
  const recommendation = await apiPost(
    `/api/lead-intelligence/leads/${state.leadId}/decisions`,
    auth.accessToken,
    {}
  );
  const [lead, intelligence] = await Promise.all([
    apiGet(`/api/leads/${state.leadId}`, auth.accessToken),
    apiGet(`/api/lead-intelligence/leads/${state.leadId}`, auth.accessToken)
  ]);
  if (lead.automationOwnershipState !== "AI_ACTIVE") {
    throw new Error(
      `Lead intelligence reopened human intervention: ${lead.automationOwnershipState}`
    );
  }
  if (["ESCALATE", "ASK_HUMAN"].includes(recommendation.decision)) {
    throw new Error(`Resolved client risk was incorrectly reopened: ${recommendation.decision}`);
  }
  if (!intelligence.summary.includes("AI follow-up is active")) {
    throw new Error(`Lead memory responsibility is unclear: ${intelligence.summary}`);
  }
  if (intelligence.commitments.some((item) => item.includes("received your request"))) {
    throw new Error("Automatic acknowledgement was incorrectly recorded as a human commitment");
  }
  if (!intelligence.objections.some((item) => /price|discount/iu.test(item))) {
    throw new Error("The grounded pricing request is missing from client intelligence");
  }
  if (!intelligence.evidence.some((item) => item.quote.includes("15,000 contacts"))) {
    throw new Error("Lead intelligence is missing the grounded migration evidence");
  }

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=AI%20Insights`);
  await page.getByRole("heading", { name: "Client intelligence" }).waitFor();
  await page.getByText("AI follow-up is active", { exact: false }).waitFor();
  await page.getByText("15,000 contacts", { exact: false }).first().waitFor();
  await page.waitForTimeout(700);
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible:
      /HUMAN_ACTIVE|HUMAN_ACTION_COMPLETED|AI_ACTIVE|AI_STOPPED|HUMAN_REQUIRED/u.test(
        document.body.innerText
      ),
    rawGuardrailVisible: /HIGH_RISK_CLIENT_CONTEXT|OWNERSHIP_BLOCKED|AI_CONTROL_/u.test(
      document.body.innerText
    ),
    summaryVisible: document.body.innerText.includes("AI follow-up is active"),
    groundedNeedVisible:
      /600 (?:monthly leads|leads each month)/iu.test(document.body.innerText) &&
      document.body.innerText.includes("15,000 contacts"),
    controlsVisible:
      document.body.innerText.includes("Follow-up policy") &&
      document.body.innerText.includes("Preferred channel")
  }));
  if (pageCheck.horizontalOverflow)
    throw new Error("Lead intelligence screen has horizontal overflow");
  if (pageCheck.rawStateVisible || pageCheck.rawGuardrailVisible) {
    throw new Error(`Lead intelligence exposes internal language: ${JSON.stringify(pageCheck)}`);
  }
  if (!pageCheck.summaryVisible || !pageCheck.groundedNeedVisible || !pageCheck.controlsVisible) {
    throw new Error(`Lead intelligence UI is incomplete: ${JSON.stringify(pageCheck)}`);
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  const screenshot = path.join(outputDir, "12-lead-intelligence.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify({ ...state, leadIntelligenceVerifiedAt: new Date().toISOString() }, null, 2)
  );
  process.stdout.write(
    JSON.stringify({
      step: 12,
      leadId: state.leadId,
      recommendation: recommendation.decision,
      ownership: lead.automationOwnershipState,
      evidenceCount: intelligence.evidence.length,
      screenshot,
      pageCheck
    })
  );
}

async function verifyDocumentIntelligence(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1-12 before step 13");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const title = "Aurevia CRM discovery scope";
  const content = [
    "Aurevia discovery scope approved for discussion:",
    "25 sales users and about 600 new leads per month.",
    "Migration estimate: 15,000 contacts.",
    "Requested integrations: email, WhatsApp, and Google Calendar.",
    "Discovery call: Tuesday at 11:00 AM IST.",
    "No discount is approved.",
    "February 2027 is a target only, not a delivery guarantee.",
    "Pricing, legal terms, discounts, and delivery commitments require written human approval."
  ].join("\n");
  let intelligence = await apiGet(`/api/lead-intelligence/leads/${state.leadId}`, auth.accessToken);
  const existing = intelligence.documents.find((document) => document.title === title);
  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=AI%20Insights`);
  await page.getByRole("heading", { name: "Grounded sources" }).waitFor();
  if (!existing) {
    await page.getByRole("button", { name: "Add document" }).click();
    const dialog = page.getByRole("dialog", { name: "Add lead document" });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Document source").selectOption("PASTE");
    await dialog.getByLabel("Document text").fill(content);
    await dialog.getByRole("button", { name: "Index document" }).click();
    await dialog.waitFor({ state: "detached" });
  }
  await page.getByText(title, { exact: true }).waitFor();
  await page.getByText("Audit / Ready / 1 evidence section", { exact: true }).waitFor();
  intelligence = await apiGet(`/api/lead-intelligence/leads/${state.leadId}`, auth.accessToken);
  const document = intelligence.documents.find((item) => item.title === title);
  if (!document || document.status !== "INDEXED" || document.chunkCount < 1) {
    throw new Error(`Document was not indexed: ${JSON.stringify(document)}`);
  }
  if (!document.extractedText?.includes("No discount is approved")) {
    throw new Error("Persisted document text is incomplete");
  }
  if (
    !intelligence.evidence.some(
      (item) => item.sourceType === "DOCUMENT" && item.quote.includes("15,000 contacts")
    )
  ) {
    throw new Error("Indexed discovery scope is not available as grounded lead evidence");
  }
  if (
    intelligence.evidence.some(
      (item) => item.sourceType === "DOCUMENT" && /25% discount is approved/iu.test(item.quote)
    )
  ) {
    throw new Error("Document intelligence invented discount approval");
  }
  await page.waitForTimeout(500);
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawDocumentStateVisible: /\b(INDEXED|NEEDS_CONTENT|UPLOAD)\b/u.test(document.body.innerText),
    documentVisible: document.body.innerText.includes("Aurevia CRM discovery scope"),
    statusVisible: document.body.innerText.includes("Audit / Ready / 1 evidence section")
  }));
  if (pageCheck.horizontalOverflow)
    throw new Error("Document intelligence screen has horizontal overflow");
  if (pageCheck.rawDocumentStateVisible)
    throw new Error("Document intelligence exposes internal states");
  if (!pageCheck.documentVisible || !pageCheck.statusVisible) {
    throw new Error(`Document intelligence UI is incomplete: ${JSON.stringify(pageCheck)}`);
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const screenshot = path.join(outputDir, "13-document-intelligence.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        ...state,
        discoveryDocumentId: document.id,
        documentIntelligenceVerifiedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 13,
      leadId: state.leadId,
      documentId: document.id,
      status: document.status,
      evidenceSections: document.chunkCount,
      screenshot,
      pageCheck
    })
  );
}

function nextWeekdayDate(weekday) {
  const value = new Date();
  const days = (weekday - value.getDay() + 7) % 7 || 7;
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function slotAtLocalTime(slot, date, hour, minute) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(new Date(slot.startsAt))
      .filter((item) => item.type !== "literal")
      .map((item) => [item.type, item.value])
  );
  return (
    `${parts.year}-${parts.month}-${parts.day}` === date &&
    Number(parts.hour) === hour &&
    Number(parts.minute) === minute
  );
}

async function verifyMeetingFlow(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1-13 before step 14");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const title = "Aurevia CRM discovery call";
  const meetingDate = nextWeekdayDate(2);
  let requests = await apiGet(`/api/meetings/requests?leadId=${state.leadId}`, auth.accessToken);
  let request = requests.find((item) => item.title === title) ?? null;
  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Meetings`);
  await page.getByRole("heading", { name: "Schedule meeting" }).waitFor();

  if (!request) {
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Start date").fill(meetingDate);
    await page.getByLabel("Start time").fill("11:00");
    await page.getByLabel("End date").fill(meetingDate);
    await page.getByLabel("End time").fill("12:00");
    await page.getByLabel("Minutes").fill("30");
    await page.getByRole("button", { name: "Find available times" }).click();
    request = await waitForApi(async () => {
      const current = await apiGet(
        `/api/meetings/requests?leadId=${state.leadId}`,
        auth.accessToken
      );
      return current.find((item) => item.title === title) ?? null;
    }, 45000);
  }
  if (request.status === "ATTENTION_REQUIRED") {
    throw new Error(`Calendar slot request needs attention: ${request.providerLastError}`);
  }
  if (request.status !== "CONFIRMED") {
    const proposedSlots = request.slots.filter((slot) => slot.status === "PROPOSED");
    const selectedSlot =
      proposedSlots.find((slot) => slotAtLocalTime(slot, meetingDate, 11, 0)) ?? proposedSlots[0];
    if (!selectedSlot) {
      throw new Error(
        `Google Calendar returned no available slot: ${JSON.stringify(request.slots)}`
      );
    }
    const selectedIndex = proposedSlots.findIndex((slot) => slot.id === selectedSlot.id);
    const confirmButton = page.locator(".meeting-slot-grid").getByRole("button", { name: /^Confirm / }).nth(selectedIndex);
    await confirmButton.waitFor();
    await confirmButton.click();
    request = await waitForApi(async () => {
      const current = await apiGet(
        `/api/meetings/requests?leadId=${state.leadId}`,
        auth.accessToken
      );
      const value = current.find((item) => item.id === request.id);
      return value && ["CONFIRMED", "ATTENTION_REQUIRED"].includes(value.status) ? value : null;
    }, 60000);
  }
  if (request.status !== "CONFIRMED") {
    throw new Error(
      `Calendar confirmation failed safely: ${request.providerLastError ?? request.status}`
    );
  }
  if (
    request.providerSyncStatus !== "SYNCED" ||
    !request.providerMeetingId ||
    !request.providerMeetingUrl
  ) {
    throw new Error("Google Calendar did not return persisted confirmation evidence");
  }
  const [lead, tasks, activities] = await Promise.all([
    apiGet(`/api/leads/${state.leadId}`, auth.accessToken),
    apiGet(`/api/tasks?leadId=${state.leadId}`, auth.accessToken),
    apiGet(`/api/leads/${state.leadId}/activities`, auth.accessToken)
  ]);
  if (!activities.some((activity) => activity.type === "MEETING_CONFIRMED")) {
    throw new Error("Meeting confirmation is missing from the business activity timeline");
  }
  const openTasks = tasks.filter((task) => task.status !== "COMPLETED");
  if (openTasks.length > 1 || (openTasks[0] && openTasks[0].title !== lead.nextAction)) {
    throw new Error(
      `Meeting action and manager task are not synchronized: ${JSON.stringify({ nextAction: lead.nextAction, openTasks: openTasks.map((task) => task.title) })}`
    );
  }

  await page.getByText("Confirmed time", { exact: true }).waitFor({ timeout: 45000 });
  await page.getByText("Google Calendar sent an invitation", { exact: false }).waitFor();
  await page.waitForTimeout(700);
  const pageCheck = await page.evaluate(() => {
    const text = document.body.innerText;
    const normalized = text.toLowerCase();
    return {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      rawStateVisible:
        /CONFIRMATION_REQUIRED|PROVIDER_PENDING|ATTENTION_REQUIRED|\bSYNCED\b|\bPENDING\b/u.test(
          text
        ),
      eventIdVisible: normalized.includes("event id"),
      confirmedVisible:
        normalized.includes("confirmed time") && normalized.includes("calendar: confirmed"),
      invitationVisible: normalized.includes("google calendar sent an invitation"),
      staleAlertVisible: normalized.includes("meeting slots need confirmation"),
      optionalCrmFailureVisible: normalized.includes("zoho bigin: update failed")
    };
  });
  if (pageCheck.horizontalOverflow) throw new Error("Meeting screen has horizontal overflow");
  if (
    pageCheck.rawStateVisible ||
    pageCheck.eventIdVisible ||
    pageCheck.staleAlertVisible ||
    pageCheck.optionalCrmFailureVisible
  ) {
    throw new Error(
      `Meeting screen exposes low-level provider details: ${JSON.stringify(pageCheck)}`
    );
  }
  if (!pageCheck.confirmedVisible || !pageCheck.invitationVisible) {
    throw new Error(`Meeting confirmation UI is incomplete: ${JSON.stringify(pageCheck)}`);
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const screenshot = path.join(outputDir, "14-meeting-confirmed.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        ...state,
        meetingRequestId: request.id,
        providerMeetingId: request.providerMeetingId,
        meetingStartsAt: request.slots.find((slot) => slot.id === request.selectedSlotId)?.startsAt,
        meetingVerifiedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 14,
      leadId: state.leadId,
      meetingRequestId: request.id,
      provider: "Google Calendar",
      status: request.status,
      startsAt: request.slots.find((slot) => slot.id === request.selectedSlotId)?.startsAt,
      screenshot,
      pageCheck
    })
  );
}

async function verifyProposalFlow(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1 through 14 before step 15");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const title = "Aurevia Connected CRM Discovery Proposal";
  const confirmedMeeting = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date(state.meetingStartsAt));
  const content = `Prepared for Rhea Malhotra, Aurevia Industrial Systems Pvt Ltd

Scope for discovery
- CRM rollout planning for 25 sales users
- Approximately 600 new leads per month
- Migration planning for approximately 15,000 contacts
- Email, WhatsApp, and Google Calendar integrations

Commercial review
The current CRM opportunity value of INR 1,850,000 is planning context, not a final quote.
No discount is approved. The requested 25% discount remains subject to written human approval.
Pricing, legal terms, discounts, and commercial commitments require written approval.

Delivery planning
February 2027 is a target for planning only and is not a delivery guarantee.
Final scope, timeline, and commitments will be confirmed after discovery and internal review.

Next step
Discovery meeting confirmed for ${confirmedMeeting} IST.`;

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Proposals`);
  await page.getByRole("tab", { name: "Proposals" }).waitFor();

  let proposals = await apiGet(`/api/proposals?leadId=${state.leadId}&limit=50`, auth.accessToken);
  if (proposals.length === 0) {
    await page.getByRole("button", { name: "Generate grounded proposal" }).click();
    proposals = await waitForApi(async () => {
      const items = await apiGet(
        `/api/proposals?leadId=${state.leadId}&limit=50`,
        auth.accessToken
      );
      return items.length > 0 ? items : null;
    }, 45000);
  }

  let proposal = proposals[0];
  await page.getByRole("region", { name: "Proposal review" }).waitFor({ timeout: 45000 });
  if (["DRAFT", "WAITING_APPROVAL"].includes(proposal.status)) {
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.locator(".proposal-editor .proposal-field textarea").first().fill(content);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    proposal = await waitForApi(async () => {
      const items = await apiGet(
        `/api/proposals?leadId=${state.leadId}&limit=50`,
        auth.accessToken
      );
      const current = items.find((item) => item.id === proposal.id);
      return current?.title === title && current.currentVersion?.content === content
        ? current
        : null;
    });
  }
  if (proposal.status === "DRAFT") {
    proposal = await apiPost(`/api/proposals/${proposal.id}/submit`, auth.accessToken, {
      reason: "Ready for manager approval"
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
  }
  if (proposal.status === "WAITING_APPROVAL") {
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    proposal = await waitForApi(async () => {
      const current = await apiGet(`/api/proposals/${proposal.id}`, auth.accessToken);
      return current.status === "APPROVED" ? current : null;
    });
  }
  if (proposal.status === "APPROVED") {
    await page.getByRole("button", { name: "Send approved", exact: true }).click();
    proposal = await waitForApi(async () => {
      const current = await apiGet(`/api/proposals/${proposal.id}`, auth.accessToken);
      return current.status === "SENT" ? current : null;
    }, 45000);
  }

  proposal = await waitForApi(async () => {
    const current = await apiGet(`/api/proposals/${proposal.id}`, auth.accessToken);
    return current.status === "SENT" && current.zohoTimelineSyncStatus !== "PENDING"
      ? current
      : null;
  }, 30000);

  if (proposal.status !== "SENT" || !proposal.sentOutboundEmailId) {
    throw new Error("Proposal was not sent from its approved version");
  }
  if (
    proposal.currentVersion?.content !== content ||
    proposal.approvedVersion?.content !== content
  ) {
    throw new Error("Sent proposal does not match the human-reviewed approved content");
  }
  if (proposal.zohoTimelineSyncStatus !== "NOT_REQUIRED") {
    throw new Error(
      `Native CRM proposal has incorrect Zoho status ${proposal.zohoTimelineSyncStatus}`
    );
  }

  const retry = await apiPost(`/api/proposals/${proposal.id}/send`, auth.accessToken, {});
  if (retry.outboundEmail.id !== proposal.sentOutboundEmailId) {
    throw new Error("Proposal retry created a duplicate outbound email");
  }
  const activities = await apiGet(`/api/leads/${state.leadId}/activities`, auth.accessToken);
  for (const type of ["PROPOSAL_GENERATED", "PROPOSAL_APPROVED", "PROPOSAL_SENT"]) {
    if (!activities.some((activity) => activity.type === type)) {
      throw new Error(`Proposal activity ${type} was not persisted`);
    }
  }

  const mailpitUrl = process.env.MAILPIT_HTTP_URL || "http://localhost:8025";
  const mailboxResponse = await fetch(
    `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${state.data.email}`)}`
  );
  if (!mailboxResponse.ok) throw new Error(`Mailpit lookup failed (${mailboxResponse.status})`);
  const mailbox = await mailboxResponse.json();
  const sentMatches = (mailbox.messages || []).filter((message) => message.Subject === title);
  if (sentMatches.length !== 1) {
    throw new Error(`Expected one proposal email in Mailpit, found ${sentMatches.length}`);
  }
  const messageResponse = await fetch(`${mailpitUrl}/api/v1/message/${sentMatches[0].ID}`);
  if (!messageResponse.ok)
    throw new Error(`Mailpit message lookup failed (${messageResponse.status})`);
  const message = await messageResponse.json();
  const messageText = `${message.Text || ""}\n${message.HTML || ""}`;
  for (const expected of [
    "No discount is approved",
    "not a delivery guarantee",
    "require written approval"
  ]) {
    if (!messageText.includes(expected)) throw new Error(`Proposal email omitted: ${expected}`);
  }

  await page.reload();
  await page.getByRole("region", { name: "Proposal review" }).waitFor({ timeout: 30000 });
  await page.getByText("Sent", { exact: true }).first().waitFor();
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible: /WAITING_APPROVAL|NOT_REQUIRED|SKIPPED|HUMAN_ACTIVE|AI_ACTIVE/u.test(
      document.body.innerText
    ),
    groundedSafetyVisible: Array.from(document.querySelectorAll("textarea")).some(
      (element) =>
        element.value.includes("No discount is approved") &&
        element.value.includes("not a delivery guarantee")
    ),
    sentVisible: /\bSENT\b/iu.test(document.body.innerText)
  }));
  if (pageCheck.horizontalOverflow) throw new Error("Proposal screen has horizontal overflow");
  if (pageCheck.rawStateVisible) throw new Error("Proposal screen exposes a raw technical state");
  if (!pageCheck.groundedSafetyVisible || !pageCheck.sentVisible) {
    await page.screenshot({ path: path.join(outputDir, "15-proposal-debug.png"), fullPage: true });
    throw new Error(
      `Proposal screen does not show its grounded sent state: ${JSON.stringify(pageCheck)}`
    );
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);

  const screenshot = path.join(outputDir, "15-proposal-sent.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        ...state,
        proposalId: proposal.id,
        proposalSentAt: proposal.sentAt,
        proposalScreenshot: screenshot
      },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 15,
      leadId: state.leadId,
      proposalId: proposal.id,
      status: proposal.status,
      emailCount: sentMatches.length,
      duplicateSafe: true,
      screenshot,
      pageCheck
    })
  );
}

async function verifyNegotiationSafety(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1 through 15 before step 16");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const [lead, activities, conversations, notifications] = await Promise.all([
    apiGet(`/api/leads/${state.leadId}`, auth.accessToken),
    apiGet(`/api/leads/${state.leadId}/activities`, auth.accessToken),
    apiGet(`/api/conversations?leadId=${state.leadId}`, auth.accessToken),
    apiGet("/api/notifications", auth.accessToken)
  ]);
  if (lead.automationOwnershipState !== "AI_ACTIVE") {
    throw new Error(`Negotiation safety ended with ${lead.automationOwnershipState}`);
  }
  const leadNotifications = notifications.filter((item) => item.leadId === state.leadId);
  if (
    leadNotifications.some(
      (item) =>
        item.negotiationHandoff &&
        !["RESOLVED", "ACKNOWLEDGED"].includes(item.negotiationHandoff.status)
    )
  ) {
    throw new Error("Negotiation handoff is still open after the manager response");
  }
  const activityText = activities.map((item) => `${item.title}\n${item.description}`).join("\n");
  if (
    !activityText.includes("pricing request") ||
    !activityText.includes("completed the handoff")
  ) {
    throw new Error("Negotiation escalation and resolution are not both auditable");
  }
  const messageText = conversations
    .flatMap((conversation) => conversation.messages || [])
    .map((message) => message.body || message.content || "")
    .join("\n");
  if (/25% discount (is|has been) approved|we (accept|agree to) the legal/iu.test(messageText)) {
    throw new Error("Conversation contains an unauthorized pricing or legal commitment");
  }

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Conversation`);
  await page.getByText("25% discount", { exact: false }).first().waitFor({ timeout: 30000 });
  await page.getByText("I cannot approve a 25% discount", { exact: false }).waitFor();
  await page.getByText("AI following up", { exact: true }).waitFor();
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible: /ASK_HUMAN|ESCALATE|HUMAN_REQUIRED|AI_ACTIVE/u.test(document.body.innerText),
    requestVisible: document.body.innerText.includes("25% discount"),
    safeResponseVisible: document.body.innerText.includes("I cannot approve a 25% discount"),
    resolvedVisible: document.body.innerText.includes("AI following up")
  }));
  if (pageCheck.horizontalOverflow) throw new Error("Negotiation screen has horizontal overflow");
  if (pageCheck.rawStateVisible)
    throw new Error("Negotiation screen exposes a raw technical state");
  if (!pageCheck.requestVisible || !pageCheck.safeResponseVisible || !pageCheck.resolvedVisible) {
    throw new Error(
      "Negotiation screen does not explain the request, response, and resumed ownership"
    );
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  const screenshot = path.join(outputDir, "16-negotiation-human-safety.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify({ ...state, negotiationSafetyScreenshot: screenshot }, null, 2)
  );
  process.stdout.write(
    JSON.stringify({ step: 16, leadId: state.leadId, safe: true, screenshot, pageCheck })
  );
}

async function verifyDealPipeline(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1 through 16 before step 17");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/deals`);
  await page.getByRole("heading", { name: "Deals", exact: true }).waitFor();

  let dealPage = await apiGet(
    `/api/deals?search=${encodeURIComponent(state.data.company)}&pageSize=100`,
    auth.accessToken
  );
  let deal = dealPage.items.find((item) => item.leadId === state.leadId);
  if (!deal) {
    await page.getByRole("button", { name: "New deal", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "New deal" });
    await dialog.getByLabel("Related lead").selectOption(state.leadId);
    await dialog.getByRole("button", { name: "Create deal", exact: true }).click();
    deal = await waitForApi(async () => {
      const result = await apiGet(
        `/api/deals?search=${encodeURIComponent(state.data.company)}&pageSize=100`,
        auth.accessToken
      );
      return result.items.find((item) => item.leadId === state.leadId) || null;
    });
  }

  await page.getByRole("button", { name: "Pipeline view" }).click();
  await page.getByRole("region", { name: "Pipeline board" }).waitFor();
  const companyCard = page
    .getByRole("region", { name: "Pipeline board" })
    .locator(`[data-deal-id="${deal.id}"]`);
  await companyCard.waitFor();

  const second = await openAuthenticatedPage(auth);
  await second.page.goto(`${baseUrl}/deals`);
  await second.page.getByRole("button", { name: "Pipeline view" }).click();
  await second.page.getByRole("region", { name: "Pipeline board" }).waitFor();

  const negotiationColumn = page
    .getByRole("region", { name: "Pipeline board" })
    .locator("section.deal-column")
    .filter({ hasText: /^Negotiation/u });
  if ((await negotiationColumn.count()) !== 1) {
    throw new Error("Configured pipeline does not expose one Negotiation stage");
  }
  if (deal.stage.label !== "Negotiation") {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await companyCard.dispatchEvent("dragstart", { dataTransfer });
    await negotiationColumn.dispatchEvent("dragover", { dataTransfer });
    await negotiationColumn.dispatchEvent("drop", { dataTransfer });
    deal = await waitForApi(async () => {
      const current = await apiGet(`/api/deals/${deal.id}`, auth.accessToken);
      return current.stage.label === "Negotiation" ? current : null;
    });
  }

  const secondNegotiation = second.page
    .locator("section.deal-column")
    .filter({ hasText: /^Negotiation/u });
  await secondNegotiation.locator(`[data-deal-id="${deal.id}"]`).waitFor({ timeout: 30000 });

  await page.reload();
  await page.getByRole("button", { name: "Pipeline view" }).click();
  const persistedCard = page
    .locator("section.deal-column")
    .filter({ hasText: /^Negotiation/u })
    .locator(`[data-deal-id="${deal.id}"]`);
  await persistedCard.waitFor();
  await persistedCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const persistedCardBox = await persistedCard.boundingBox();
  const viewport = page.viewportSize();
  if (
    !persistedCardBox ||
    !viewport ||
    persistedCardBox.x < 0 ||
    persistedCardBox.x + persistedCardBox.width > viewport.width
  ) {
    throw new Error("Persisted Negotiation deal is not visible in the pipeline viewport");
  }
  const activities = await apiGet(`/api/leads/${state.leadId}/activities`, auth.accessToken);
  if (
    !activities.some(
      (activity) => activity.type === "DEAL_UPDATED" && activity.title === "Deal stage changed"
    )
  ) {
    throw new Error("Deal stage move did not create an activity record");
  }
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    boardVisible: Boolean(document.querySelector('[aria-label="Pipeline board"]')),
    companyVisible: document.body.innerText.includes("Aurevia Industrial Systems Pvt Ltd"),
    negotiationVisible: document.body.innerText.includes("Negotiation")
  }));
  if (pageCheck.horizontalOverflow)
    throw new Error("Deal pipeline has page-level horizontal overflow");
  if (!pageCheck.boardVisible || !pageCheck.companyVisible || !pageCheck.negotiationVisible) {
    throw new Error("Deal pipeline does not show the persisted opportunity stage");
  }
  if (browserErrors.length || second.browserErrors.length) {
    throw new Error(`Browser errors: ${[...browserErrors, ...second.browserErrors].join(" | ")}`);
  }
  const screenshot = path.join(outputDir, "17-deal-pipeline-realtime.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await second.browser.close();
  await browser.close();
  fs.writeFileSync(
    statePath,
    JSON.stringify({ ...state, dealId: deal.id, dealScreenshot: screenshot }, null, 2)
  );
  process.stdout.write(
    JSON.stringify({
      step: 17,
      leadId: state.leadId,
      dealId: deal.id,
      stage: deal.stage.label,
      secondBrowserRealtime: true,
      screenshot,
      pageCheck
    })
  );
}

async function verifyTerminalSafety(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1 through 17 before step 18");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const currentLead = await apiGet(`/api/leads/${state.leadId}`, auth.accessToken);
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/gu, "")
    .slice(0, 14);

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=AI+Insights`);
  await page.getByLabel("Lead AI status").waitFor();
  await page.getByLabel("Lead AI status").selectOption("PAUSED");
  await waitForApi(async () => {
    const lead = await apiGet(`/api/leads/${state.leadId}`, auth.accessToken);
    return lead.automationOwnershipState === "AI_STOPPED" ? lead : null;
  });
  await page.getByRole("button", { name: "AI paused", exact: true }).waitFor();
  await page.getByLabel("Lead AI status").selectOption("ON");
  await waitForApi(async () => {
    const lead = await apiGet(`/api/leads/${state.leadId}`, auth.accessToken);
    return lead.automationOwnershipState === "AI_ACTIVE" ? lead : null;
  });
  await apiPost(
    `/api/followups/leads/${state.leadId}/calling/e2e/run-now`,
    auth.accessToken
  );
  await waitForApi(async () => {
    const activities = await apiGet(
      `/api/leads/${state.leadId}/activities`,
      auth.accessToken
    );
    return activities.some((item) => item.type === "WHATSAPP_FAILED") &&
      activities.some((item) => item.type === "CALL_FAILED")
      ? activities
      : null;
  });

  async function createSafetyLead(kind, firstName, emailPrefix) {
    const contact = await apiPost("/api/contacts", auth.accessToken, {
      companyId: currentLead.companyId,
      firstName,
      lastName: "Safety",
      title: "CRM Safety Review",
      email: `${emailPrefix}.${runId}@mailpit.local`,
      source: "Manual safety validation",
      preferredChannel: "EMAIL"
    });
    const lead = await apiPost("/api/leads", auth.accessToken, {
      companyId: currentLead.companyId,
      contactId: contact.id,
      ownerId: auth.user.id,
      source: `Safety validation - ${kind}`,
      requirement: `Verify ${kind} permanently blocks automated outreach`,
      serviceInterest: "CRM safety controls",
      estimatedValue: "250000",
      currency: "INR",
      nextAction: `Validate ${kind} safety`
    });
    return { contact, lead };
  }

  const existingSafetyLeads = await apiGet("/api/leads?pageSize=100", auth.accessToken);
  let dncLead = state.dncLeadId
    ? await apiGet(`/api/leads/${state.dncLeadId}`, auth.accessToken).catch(() => null)
    : (existingSafetyLeads.items.find(
        (lead) =>
          lead.companyId === currentLead.companyId &&
          lead.source === "Safety validation - do not contact"
      ) ?? null);
  if (!dncLead) {
    const created = await createSafetyLead("do not contact", "Devika", "devika.dnc");
    await apiPatch(`/api/contacts/${created.contact.id}`, auth.accessToken, {
      doNotContact: true
    });
    dncLead = await waitForApi(async () => {
      const lead = await apiGet(`/api/leads/${created.lead.id}`, auth.accessToken);
      return lead.contact.doNotContact && lead.automationOwnershipState === "AI_STOPPED"
        ? lead
        : null;
    });
  }

  let lostLead = state.lostLeadId
    ? await apiGet(`/api/leads/${state.lostLeadId}`, auth.accessToken).catch(() => null)
    : (existingSafetyLeads.items.find(
        (lead) =>
          lead.companyId === currentLead.companyId && lead.source === "Safety validation - lost"
      ) ?? null);
  if (!lostLead) {
    const created = await createSafetyLead("lost", "Laksh", "laksh.lost");
    await apiPatch(`/api/leads/${created.lead.id}/status`, auth.accessToken, { status: "LOST" });
    lostLead = await waitForApi(async () => {
      const lead = await apiGet(`/api/leads/${created.lead.id}`, auth.accessToken);
      return lead.status === "LOST" && lead.automationOwnershipState === "AI_STOPPED" ? lead : null;
    });
  } else if (lostLead.status !== "LOST") {
    await apiPatch(`/api/leads/${lostLead.id}/status`, auth.accessToken, { status: "LOST" });
    lostLead = await waitForApi(async () => {
      const lead = await apiGet(`/api/leads/${lostLead.id}`, auth.accessToken);
      return lead.status === "LOST" && lead.automationOwnershipState === "AI_STOPPED" ? lead : null;
    });
  }

  await page.goto(`${baseUrl}/deals`);
  await page.getByRole("button", { name: "Pipeline view" }).click();
  const board = page.getByRole("region", { name: "Pipeline board" });
  await board.waitFor();
  const card = board.locator(`[data-deal-id="${state.dealId}"]`);
  const wonColumn = board.locator("section.deal-column").filter({ hasText: /^Won/u });
  const currentDeal = await apiGet(`/api/deals/${state.dealId}`, auth.accessToken);
  if (currentDeal.status !== "WON") {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent("dragstart", { dataTransfer });
    await wonColumn.dispatchEvent("dragover", { dataTransfer });
    await wonColumn.dispatchEvent("drop", { dataTransfer });
  }
  const wonDeal = await waitForApi(async () => {
    const deal = await apiGet(`/api/deals/${state.dealId}`, auth.accessToken);
    return deal.status === "WON" && deal.stage.isWon ? deal : null;
  });
  const wonLead = await waitForApi(async () => {
    const lead = await apiGet(`/api/leads/${state.leadId}`, auth.accessToken);
    return lead.status === "WON" && lead.automationOwnershipState === "AI_STOPPED" ? lead : null;
  });

  const [wonFollowUps, dncFollowUps, lostFollowUps, activities] = await Promise.all([
    apiGet(`/api/followups/leads/${state.leadId}`, auth.accessToken),
    apiGet(`/api/followups/leads/${dncLead.id}`, auth.accessToken),
    apiGet(`/api/followups/leads/${lostLead.id}`, auth.accessToken),
    apiGet(`/api/leads/${state.leadId}/activities`, auth.accessToken)
  ]);
  for (const [label, sequences] of [
    ["Won", wonFollowUps],
    ["DNC", dncFollowUps],
    ["Lost", lostFollowUps]
  ]) {
    if (sequences.some((sequence) => sequence.status === "ACTIVE")) {
      throw new Error(`${label} lead retained active follow-up automation`);
    }
  }
  if (!activities.some((item) => item.type === "WHATSAPP_FAILED")) {
    throw new Error("Unavailable WhatsApp provider did not fail safely and visibly");
  }
  if (!activities.some((item) => item.type === "CALL_FAILED")) {
    throw new Error("Unavailable voice provider did not fail safely and visibly");
  }

  await page.goto(`${baseUrl}/crm/leads/${state.leadId}?tab=Overview`);
  await page.getByText("WON", { exact: true }).first().waitFor();
  await page.getByText("AI stopped", { exact: true }).first().waitFor();
  const wonScreenshot = path.join(outputDir, "18a-won-automation-stopped.png");
  await page.screenshot({ path: wonScreenshot, fullPage: true });

  await page.goto(`${baseUrl}/crm/leads/${dncLead.id}?tab=Overview`);
  await page.getByText("Do not contact", { exact: true }).first().waitFor();
  await page.getByText("AI stopped", { exact: true }).first().waitFor();
  const quickActions = page.locator(".profile-quick-actions");
  const dncActions =
    await quickActions.getByRole("button", { name: /^(Email|Call|Send email|WhatsApp)$/u }).count() +
    await quickActions.locator('a[href^="tel:"], a[href^="mailto:"]').count();
  if (dncActions !== 0) throw new Error("DNC lead still exposes direct outreach actions");
  const dncScreenshot = path.join(outputDir, "18b-do-not-contact-stopped.png");
  await page.screenshot({ path: dncScreenshot, fullPage: true });

  await page.goto(`${baseUrl}/crm/leads/${lostLead.id}?tab=Overview`);
  await page.getByText("LOST", { exact: true }).first().waitFor();
  await page.getByText("AI stopped", { exact: true }).first().waitFor();
  const lostScreenshot = path.join(outputDir, "18c-lost-automation-stopped.png");
  await page.screenshot({ path: lostScreenshot, fullPage: true });

  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible: /AI_STOPPED|DO_NOT_CONTACT|LEAD_LOST|DEAL_WON/u.test(document.body.innerText),
    stoppedVisible: document.body.innerText.includes("AI stopped")
  }));
  if (pageCheck.horizontalOverflow)
    throw new Error("Terminal-state profile has horizontal overflow");
  if (pageCheck.rawStateVisible)
    throw new Error("Terminal-state profile exposes a raw technical state");
  if (!pageCheck.stoppedVisible)
    throw new Error("Terminal-state profile does not explain automation stop");
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  await browser.close();

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        ...state,
        dncLeadId: dncLead.id,
        lostLeadId: lostLead.id,
        wonAt: wonDeal.updatedAt,
        terminalScreenshots: { wonScreenshot, dncScreenshot, lostScreenshot }
      },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 18,
      wonLead: { id: wonLead.id, status: wonLead.status },
      dncLead: { id: dncLead.id, doNotContact: dncLead.contact.doNotContact },
      lostLead: { id: lostLead.id, status: lostLead.status },
      manualPauseResume: true,
      providerFailureSafe: true,
      screenshots: { wonScreenshot, dncScreenshot, lostScreenshot },
      pageCheck
    })
  );
}

async function verifyOrderFlow(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1 through 18 before step 19");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const lead = await apiGet(`/api/leads/${state.leadId}`, auth.accessToken);
  const deal = await apiGet(`/api/deals/${state.dealId}`, auth.accessToken);
  if (deal.status !== "WON" || lead.status !== "WON") {
    throw new Error("Post-sale order validation requires the persisted won opportunity");
  }

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/orders`);
  await page.getByRole("heading", { name: "Order Queue" }).waitFor();
  let orderPage = await apiGet(
    `/api/orders?search=${encodeURIComponent(state.data.company)}&pageSize=100`,
    auth.accessToken
  );
  let order = orderPage.items.find((item) => item.dealId === state.dealId);
  if (!order) {
    await page.getByRole("button", { name: "New order", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New order" });
    await dialog.getByLabel("Order company").selectOption(lead.companyId);
    await dialog.getByLabel("Related deal").selectOption(state.dealId);
    await dialog.getByLabel("Item 1 name").fill("Connected CRM implementation and rollout");
    await dialog.getByLabel("Item 1 quantity").fill("1");
    await dialog.getByLabel("Item 1 unit price").fill("1850000");
    await dialog
      .getByLabel("Notes")
      .fill(
        "Post-sale onboarding created from the approved Aurevia opportunity. Payment and fulfillment are tracked independently."
      );
    await dialog.getByRole("button", { name: "Create order", exact: true }).click();
    order = await waitForApi(async () => {
      const result = await apiGet(
        `/api/orders?search=${encodeURIComponent(state.data.company)}&pageSize=100`,
        auth.accessToken
      );
      return result.items.find((item) => item.dealId === state.dealId) || null;
    });
  }

  await page.goto(`${baseUrl}/orders/${order.id}`);
  await page.getByRole("dialog", { name: "Order details" }).waitFor();
  if (order.paymentStatus !== "PARTIALLY_PAID" || order.fulfillmentStatus !== "PROCESSING") {
    await page.getByLabel("Payment status").selectOption("PARTIALLY_PAID");
    await page.getByLabel("Fulfillment status").selectOption("PROCESSING");
    await page.getByRole("button", { name: "Update state", exact: true }).click();
    order = await waitForApi(async () => {
      const current = await apiGet(`/api/orders/${order.id}`, auth.accessToken);
      return current.paymentStatus === "PARTIALLY_PAID" &&
        current.fulfillmentStatus === "PROCESSING"
        ? current
        : null;
    });
  }
  await page.getByRole("button", { name: "Partially paid", exact: true }).waitFor();
  await page.getByRole("button", { name: "Processing", exact: true }).waitFor();
  const partialCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    clipped: Array.from(document.querySelectorAll(".order-detail *")).some((element) =>
      element instanceof HTMLElement
        ? element.scrollWidth > element.clientWidth + 1 &&
          getComputedStyle(element).overflowX === "hidden"
        : false
    ),
    linkedDealVisible: document.body.innerText.includes("Deal / Won")
  }));
  if (partialCheck.horizontalOverflow || partialCheck.clipped || !partialCheck.linkedDealVisible) {
    throw new Error(`Partially paid / processing order UI failed: ${JSON.stringify(partialCheck)}`);
  }
  const partialScreenshot = path.join(outputDir, "19a-order-partial-processing.png");
  await page.screenshot({ path: partialScreenshot, fullPage: true });

  await page.getByLabel("Payment status").selectOption("PAID");
  await page.getByLabel("Fulfillment status").selectOption("FULFILLED");
  await page.getByRole("button", { name: "Update state", exact: true }).click();
  order = await waitForApi(async () => {
    const current = await apiGet(`/api/orders/${order.id}`, auth.accessToken);
    return current.paymentStatus === "PAID" && current.fulfillmentStatus === "FULFILLED"
      ? current
      : null;
  });
  await page.getByRole("button", { name: "Paid", exact: true }).waitFor();
  await page.getByRole("button", { name: "Fulfilled", exact: true }).waitFor();
  const fulfilledScreenshot = path.join(outputDir, "19b-order-paid-fulfilled.png");
  await page.screenshot({ path: fulfilledScreenshot, fullPage: true });
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  await browser.close();

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        ...state,
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderScreenshots: { partialScreenshot, fulfilledScreenshot }
      },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 19,
      label: "Extended CRM / post-sale validation",
      orderId: order.id,
      orderNumber: order.orderNumber,
      payment: order.paymentStatus,
      fulfillment: order.fulfillmentStatus,
      screenshots: { partialScreenshot, fulfilledScreenshot },
      partialCheck
    })
  );
}

async function verifyManagerDashboards(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run steps 1 through 19 before step 20");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  let deal = await apiGet(`/api/deals/${state.dealId}`, auth.accessToken);
  if (deal.value !== state.data.value || deal.currency !== "INR") {
    deal = await apiPatch(`/api/deals/${state.dealId}`, auth.accessToken, {
      value: state.data.value,
      currency: "INR"
    });
  }
  const [dashboard, command] = await Promise.all([
    apiGet("/api/action-dashboard", auth.accessToken),
    apiGet("/api/lead-intelligence/command-center", auth.accessToken)
  ]);
  if (deal.status !== "WON" || deal.value !== state.data.value) {
    throw new Error("Won deal value is not synchronized with the source opportunity");
  }
  if (dashboard.pendingProposalApprovals.some((item) => item.leadId === state.leadId)) {
    throw new Error("Sent proposal still appears as waiting for approval");
  }
  if (dashboard.negotiationAndTakeoverAlerts.some((item) => item.leadId === state.leadId)) {
    throw new Error("Resolved negotiation still appears as an open handoff");
  }
  if (dashboard.meetings.items.some((item) => item.leadId === state.leadId)) {
    throw new Error("Confirmed meeting still appears as requiring action");
  }
  if (dashboard.failuresRequiringAttention.some((item) =>
    /ownership stopped pending execution|Inbound reply stopped pending/u.test(item.detail ?? "")
  )) {
    throw new Error("Expected automation stops still appear as retryable failures");
  }
  if (command.recommendations.some((item) => item.leadId === state.leadId)) {
    throw new Error("Won lead still appears in active AI recommendations");
  }
  if (Number(command.humanKpis.revenue) < Number(state.data.value)) {
    throw new Error("Command center revenue does not include the won deal value");
  }

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/dashboard`);
  await page.getByRole("heading", { name: "Sales Engineer Actions" }).waitFor();
  await page.waitForTimeout(750);
  const dashboardCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawOwnershipVisible:
      /HUMAN_ACTIVE|HUMAN_ACTION_COMPLETED|AI_ACTIVE|AI_STOPPED|HUMAN_REQUIRED/u.test(
        document.body.innerText
      ),
    internalProviderCodeVisible: document.body.innerText.includes("E2E_NUMBER_NOT_ALLOWED")
  }));
  if (Object.values(dashboardCheck).some(Boolean)) {
    throw new Error(`Manager dashboard presentation failed: ${JSON.stringify(dashboardCheck)}`);
  }
  const dashboardScreenshot = path.join(outputDir, "20a-manager-dashboard.png");
  await page.screenshot({ path: dashboardScreenshot, fullPage: true });

  await page.goto(`${baseUrl}/ai-command-center`);
  await page.getByRole("heading", { name: "Your sales briefing is ready" }).waitFor();
  await page.getByText("Pipeline value", { exact: true }).waitFor();
  await page.waitForTimeout(750);
  const commandCheck = await page.evaluate(
    (leadId) => ({
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      rawOwnershipVisible:
        /HUMAN_ACTIVE|HUMAN_ACTION_COMPLETED|AI_ACTIVE|AI_STOPPED|HUMAN_REQUIRED/u.test(
          document.body.innerText
        ),
      wonLeadRecommended: Boolean(document.querySelector(`[data-lead-id="${leadId}"]`))
    }),
    state.leadId
  );
  if (
    commandCheck.horizontalOverflow ||
    commandCheck.rawOwnershipVisible ||
    commandCheck.wonLeadRecommended
  ) {
    throw new Error(`AI Command synchronization failed: ${JSON.stringify(commandCheck)}`);
  }
  const commandScreenshot = path.join(outputDir, "20b-ai-command-center.png");
  await page.screenshot({ path: commandScreenshot, fullPage: true });
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  await browser.close();

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        ...state,
        managerDashboardVerifiedAt: new Date().toISOString(),
        managerDashboardScreenshots: { dashboardScreenshot, commandScreenshot }
      },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 20,
      dealValue: deal.value,
      revenue: command.humanKpis.revenue,
      currentFlowOpenActions: {
        proposals: dashboard.pendingProposalApprovals.filter((item) => item.leadId === state.leadId)
          .length,
        handoffs: dashboard.negotiationAndTakeoverAlerts.filter(
          (item) => item.leadId === state.leadId
        ).length,
        meetings: dashboard.meetings.items.filter((item) => item.leadId === state.leadId).length
      },
      screenshots: { dashboardScreenshot, commandScreenshot },
      dashboardCheck,
      commandCheck
    })
  );
}

async function verifyPerformanceMetrics(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run step 20 before step 21");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const command = await apiGet("/api/lead-intelligence/command-center", auth.accessToken);
  const requiredHuman = ["proposalsSent", "meetingsBooked", "opportunities"];
  const requiredAi = ["followUpsSent", "humanInterventions", "handovers"];
  for (const key of requiredHuman) {
    if (Number(command.humanKpis[key]) < 1) throw new Error(`Human KPI ${key} was not recorded`);
  }
  for (const key of requiredAi) {
    if (Number(command.aiKpis[key]) < 1) throw new Error(`AI KPI ${key} was not recorded`);
  }
  if (Number(command.humanKpis.revenue) < Number(state.data.value)) {
    throw new Error("Won revenue is missing from human outcomes");
  }

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/ai-command-center`);
  const human = page.getByRole("region", { name: "Human accountability metrics" });
  const ai = page.getByRole("region", { name: "AI accountability metrics" });
  await human.waitFor();
  await ai.waitFor();
  await human.scrollIntoViewIfNeeded();
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    humanVisible: document.body.innerText.includes("Team outcomes"),
    aiVisible: document.body.innerText.includes("Automation outcomes")
  }));
  if (pageCheck.horizontalOverflow || !pageCheck.humanVisible || !pageCheck.aiVisible) {
    throw new Error(`Performance UI failed: ${JSON.stringify(pageCheck)}`);
  }
  const screenshot = path.join(outputDir, "21-human-ai-performance.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  await browser.close();

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        ...state,
        performanceVerifiedAt: new Date().toISOString(),
        performanceScreenshot: screenshot
      },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 21,
      humanKpis: command.humanKpis,
      aiKpis: command.aiKpis,
      screenshot,
      pageCheck
    })
  );
}

async function verifyIntegrationReadiness(auth) {
  if (!fs.existsSync(statePath)) throw new Error("Run step 21 before step 22");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const integrations = await apiGet("/api/integrations", auth.accessToken);
  const expectedCatalog = [
    "zoho-bigin",
    "aws-ses",
    "mailpit",
    "google-calendar",
    "openai",
    "gemini",
    "twilio-whatsapp",
    "meta-whatsapp",
    "twilio-voice",
    "exotel-voice"
  ];
  for (const key of expectedCatalog) {
    if (!integrations.catalog.some((item) => item.key === key)) {
      throw new Error(`Integration catalog is missing ${key}`);
    }
  }
  for (const key of ["mailpit", "google-calendar", "zoho-bigin"]) {
    const connection = integrations.connections.find((item) => item.key === key);
    if (!connection || connection.status !== "CONNECTED") {
      throw new Error(`${key} is not visibly connected`);
    }
  }
  const aws = integrations.connections.find((item) => item.key === "aws-ses");
  if (aws && !["NEEDS_ATTENTION", "DISABLED"].includes(aws.status)) {
    throw new Error("Unconfigured AWS SES is shown as available");
  }

  const envExample = fs.readFileSync(path.resolve(".env.example"), "utf8");
  const envKeys = new Set(
    envExample
      .split(/\r?\n/u)
      .map((line) => line.match(/^([A-Z0-9_]+)=/u)?.[1])
      .filter(Boolean)
  );
  const requiredEnv = [
    "DATABASE_URL",
    "REDIS_URL",
    "DOMAIN_EVENT_QUEUE_NAME",
    "AWS_SES_REGION",
    "AWS_SES_WEBHOOK_SECRET",
    "MAILPIT_SMTP_HOST",
    "WHATSAPP_APP_SECRET",
    "TWILIO_WHATSAPP_AUTH_TOKEN",
    "TWILIO_AUTH_TOKEN",
    "EXOTEL_API_TOKEN",
    "EXOTEL_WEBHOOK_SECRET",
    "GOOGLE_CALENDAR_CLIENT_ID",
    "GOOGLE_CALENDAR_CLIENT_SECRET",
    "GOOGLE_CALENDAR_REFRESH_TOKEN",
    "ZOHO_BIGIN_CLIENT_ID",
    "ZOHO_BIGIN_CLIENT_SECRET",
    "ZOHO_BIGIN_REFRESH_TOKEN",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "WEB_ORIGIN",
    "VITE_API_BASE_URL",
    "REALTIME_INTERNAL_SECRET",
    "OPS_ALERT_WEBHOOK_URL",
    "OPS_ALERT_WEBHOOK_SECRET"
  ];
  const missingEnv = requiredEnv.filter((key) => !envKeys.has(key));
  if (missingEnv.length) throw new Error(`.env.example is missing: ${missingEnv.join(", ")}`);

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
  await page.goto(`${baseUrl}/integrations`);
  await page.getByRole("heading", { name: "Integrations", exact: true }).waitFor();
  for (const name of ["Mailpit", "Google Calendar", "Zoho Bigin"]) {
    await page.getByRole("heading", { name, exact: true }).waitFor();
  }
  await page.waitForTimeout(750);
  const configuredSecrets = Object.entries(process.env)
    .filter(
      ([key, value]) => /SECRET|TOKEN|PASSWORD|API_KEY/u.test(key) && String(value).length > 8
    )
    .map(([, value]) => String(value));
  const pageCheck = await page.evaluate(
    (secrets) => ({
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      secretVisible: secrets.some((secret) => document.body.innerText.includes(secret))
    }),
    configuredSecrets
  );
  if (pageCheck.horizontalOverflow || pageCheck.secretVisible) {
    throw new Error(`Integration UI safety failed: ${JSON.stringify(pageCheck)}`);
  }
  const screenshot = path.join(outputDir, "22-integrations-readiness.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  await browser.close();

  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        ...state,
        integrationsVerifiedAt: new Date().toISOString(),
        integrationsScreenshot: screenshot
      },
      null,
      2
    )
  );
  process.stdout.write(
    JSON.stringify({
      step: 22,
      summary: integrations.summary,
      connected: integrations.connections
        .filter((item) => item.status === "CONNECTED")
        .map((item) => item.name),
      environmentPlaceholders: requiredEnv.length,
      screenshot,
      pageCheck
    })
  );
}

async function main() {
  const auth = await authenticate();
  if (process.env.LIVE_FLOW_STEP === "screens") {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const [agents, workflows] = await Promise.all([
      apiGet("/api/agents", auth.accessToken),
      apiGet("/api/workflows", auth.accessToken)
    ]);
    const agentId = agents.agents?.[0]?.id;
    const workflowId = workflows.workflows?.[0]?.id ?? workflows.items?.[0]?.id;
    const routes = [
      "/dashboard",
      "/crm",
      "/contacts",
      "/companies",
      "/deals",
      "/orders",
      "/integrations",
      "/ai-command-center",
      "/agents",
      "/workflows",
      ...[
        "Overview",
        "Conversation",
        "Qualification",
        "Proposals",
        "Activities",
        "Tasks",
        "Meetings",
        "Deal",
        "AI Insights"
      ].map((tab) => `/crm/leads/${state.leadId}?tab=${encodeURIComponent(tab)}`),
      ...(agentId
        ? ["composer", "overview", "executions", "evaluation", "versions"].map(
            (tab) => `/agents/${agentId}?tab=${tab}`
          )
        : []),
      ...(workflowId
        ? ["builder", "overview", "executions", "versions"].map(
            (tab) => `/workflows/${workflowId}?tab=${tab}`
          )
        : [])
    ];
    const { browser, page, browserErrors } = await openAuthenticatedPage(auth);
    const results = [];
    try {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (let index = 0; index < routes.length; index += 1) {
          const route = routes[index];
          await page.goto(`${baseUrl}${route}`);
          await page.waitForTimeout(1200);
          await page.waitForFunction(
            () =>
              !/Loading (lead|agents|workflows|integrations|action dashboard)/i.test(
                document.body.innerText
              ),
            { timeout: 15000 }
          );
          const check = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
            unavailable:
              /Dashboard unavailable|Integrations unavailable|Workflows unavailable|Agents unavailable|Something went wrong/.test(
                document.body.innerText
              ),
            bodyLength: document.body.innerText.length
          }));
          const screenshot = path.join(
            outputDir,
            `final-${width}-${String(index + 1).padStart(2, "0")}.png`
          );
          await page.screenshot({ path: screenshot, fullPage: false });
          results.push({ width, route, ...check, screenshot });
          if (check.overflow || check.unavailable || check.bodyLength < 100) {
            throw new Error(`Screen failed: ${JSON.stringify(results.at(-1))}`);
          }
        }
      }
      if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
      process.stdout.write(
        JSON.stringify({ screens: results.length, failures: [], screenshots: outputDir })
      );
    } finally {
      await browser.close();
    }
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "auth") {
    process.stdout.write(JSON.stringify({ authenticated: true }));
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "2") {
    await verifyAcknowledgement(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "3") {
    await verifyManagerWork(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "4") {
    await sendSubstantiveHumanResponse(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "5") {
    await verifyAiFollowUp(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "6") {
    await verifyWorkflowBuilder(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "7") {
    await verifyAgentComposer(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "8") {
    await receiveMeaningfulCustomerReply(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "9") {
    await verifyReplyClassification(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "10") {
    await sendSafeHumanNegotiationResponse(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "11") {
    await verifyPersistedQualification(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "12") {
    await verifyLeadIntelligence(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "13") {
    await verifyDocumentIntelligence(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "14") {
    await verifyMeetingFlow(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "15") {
    await verifyProposalFlow(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "16") {
    await verifyNegotiationSafety(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "17") {
    await verifyDealPipeline(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "18") {
    await verifyTerminalSafety(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "19") {
    await verifyOrderFlow(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "20") {
    await verifyManagerDashboards(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "21") {
    await verifyPerformanceMetrics(auth);
    return;
  }
  if (process.env.LIVE_FLOW_STEP === "22") {
    await verifyIntegrationReadiness(auth);
    return;
  }
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/gu, "")
    .slice(0, 14);
  const data = {
    company: "Aurevia Industrial Systems Pvt Ltd",
    website: `aurevia-${runId}.example`,
    firstName: "Rhea",
    lastName: "Malhotra",
    title: "VP Sales Transformation",
    email: `rhea.malhotra.${runId}@mailpit.local`,
    phone: "+91 98765 43120",
    source: "Website",
    requirement:
      "CRM for 25 sales users, 600 monthly leads, migration of 15,000 contacts, email, WhatsApp and Google Calendar integration, with human approval for pricing and legal commitments. Target rollout February 2027.",
    service: "Connected CRM implementation and AI sales follow-up",
    value: "1850000",
    nextAction: "Review inquiry and send discovery response"
  };

  const { browser, page, browserErrors } = await openAuthenticatedPage(auth);

  await page.goto(`${baseUrl}/crm`);
  await page.getByRole("button", { name: "New lead", exact: true }).waitFor();
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New lead" });
  await dialog.getByLabel("Company name").fill(data.company);
  await dialog.getByLabel("Website").fill(data.website);
  await dialog.getByLabel("First name").fill(data.firstName);
  await dialog.getByLabel("Last name").fill(data.lastName);
  await dialog.getByLabel("Job title").fill(data.title);
  await dialog.getByLabel("Email").fill(data.email);
  await dialog.getByLabel("Phone").fill(data.phone);
  await dialog.getByLabel("Requirement").fill(data.requirement);
  await dialog.getByLabel("Service interest").fill(data.service);
  await dialog.getByLabel("Estimated value (INR)").fill(data.value);
  await dialog.getByLabel("Next action").fill(data.nextAction);
  await dialog.getByRole("button", { name: "Create lead", exact: true }).click();
  await page.waitForURL(/\/crm\/leads\//u, { timeout: 15000 });
  await page.getByText(data.firstName, { exact: false }).first().waitFor();
  await page.waitForTimeout(500);

  const leads = await apiGet(
    `/api/leads?search=${encodeURIComponent(data.email)}`,
    auth.accessToken
  );
  const lead = leads.items?.find((item) => item.contact.email === data.email);
  if (!lead) throw new Error("Created lead was not returned by the persisted lead API");
  if (lead.automationOwnershipState !== "HUMAN_ACTIVE") {
    throw new Error(`New lead responsibility was ${lead.automationOwnershipState}`);
  }
  const pageCheck = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    rawStateVisible:
      /HUMAN_ACTIVE|HUMAN_ACTION_COMPLETED|AI_ACTIVE|AI_STOPPED|HUMAN_REQUIRED/u.test(
        document.body.innerText
      )
  }));
  if (pageCheck.horizontalOverflow) throw new Error("Lead profile has horizontal overflow");
  if (pageCheck.rawStateVisible) throw new Error("Lead profile exposes a raw ownership state");
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);

  const screenshot = path.join(outputDir, "01-lead-created.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      { data, leadId: lead.id, screenshot, createdAt: new Date().toISOString() },
      null,
      2
    )
  );
  await browser.close();
  process.stdout.write(
    JSON.stringify({ step: 1, leadId: lead.id, email: data.email, screenshot, pageCheck })
  );
}

main()
  .catch(async (error) => {
    for (const browser of activeBrowsers) {
      const page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .at(-1);
      if (page) {
        await page
          .screenshot({
            path: path.join(outputDir, `failed-step-${process.env.LIVE_FLOW_STEP || "1"}.png`),
            fullPage: true
          })
          .catch(() => undefined);
      }
    }
    process.stderr.write(error.stack || String(error));
    process.exitCode = 1;
  })
  .finally(() => Promise.allSettled([...activeBrowsers].map((browser) => browser.close())));
