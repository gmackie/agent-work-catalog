import { App } from "@modelcontextprotocol/ext-apps";

interface Offering {
  id: string; title: string; description: string;
  pricing: { mode: string; fixedAmount?: { currency: string; minorUnits: string } };
}
interface Match { offering: Offering; taskType: { name: string; description: string }; score: number; reasons: readonly string[]; }
interface SearchContent { matches?: Match[]; intent?: string; catalog?: string; }
const app = new App({ name: "Agent Work Catalog Explorer", version: "0.1.0" });
const results = document.querySelector<HTMLDivElement>("#results")!;
const status = document.querySelector<HTMLDivElement>("#status")!;
const form = document.querySelector<HTMLFormElement>("#search")!;
const query = document.querySelector<HTMLInputElement>("#query")!;

function safeText(value: unknown): string { return typeof value === "string" ? value : ""; }
function money(p: Offering["pricing"]): string {
  if (!p.fixedAmount) return "Metered";
  const minor = Number(p.fixedAmount.minorUnits);
  return Number.isSafeInteger(minor) ? new Intl.NumberFormat("en-US", {
    style:"currency",currency:p.fixedAmount.currency,
  }).format(minor/100) : "Quote required";
}
function render(data: SearchContent) {
  results.replaceChildren();
  const list = Array.isArray(data.matches) ? data.matches : [];
  status.textContent = list.length
    ? list.length + " illustrative offerings; names and prices are NOT real vendor quotes."
    : "No matches. Try 'OAuth security audit' or 'Modbus diagnostics'.";
  for (const match of list) {
    const entry = match.offering;
    const card = document.createElement("article"); card.className = "offer";
    const top = document.createElement("div"); top.className = "top";
    const info = document.createElement("div");
    const title = document.createElement("h2"); title.textContent = safeText(entry.title);
    const description = document.createElement("p"); description.textContent = safeText(entry.description);
    info.append(title, description);
    const price = document.createElement("div"); price.className = "price"; price.textContent = money(entry.pricing);
    top.append(info, price);
    const subtitle = document.createElement("div"); subtitle.className = "subtitle";
    subtitle.textContent = safeText(match.taskType?.name) + " · " + safeText(entry.id);
    const actions = document.createElement("div"); actions.className = "actions";
    const detailButton = document.createElement("button"); detailButton.type = "button"; detailButton.className = "secondary"; detailButton.textContent = "View requirements";
    const detail = document.createElement("div"); detail.className = "detail"; detail.hidden = true;
    detail.textContent = "Task: " + safeText(match.taskType?.description) + "\nMatches: " + (match.reasons ?? []).join(", ") +
      "\nPaid execution is not enabled in this demo.";
    detailButton.addEventListener("click", () => { detail.hidden = !detail.hidden; });
    actions.append(detailButton);
    card.append(top, subtitle, actions, detail);
    results.append(card);
  }
}
app.ontoolresult = (value) => {
  const content = value.structuredContent as SearchContent | undefined;
  if (content && Array.isArray(content.matches)) {
    if (content.intent) query.value = content.intent;
    render(content);
  }
};
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const intent = query.value.trim();
  if (intent.length < 3) return;
  status.textContent = "Searching the sample catalog...";
  try {
    const response = await app.callServerTool({ name: "catalog.search", arguments: { intent } });
    const data = response.structuredContent as SearchContent | undefined;
    if (data) render(data);
    else status.textContent = "The host did not return structured catalog results.";
  } catch {
    status.textContent = "This view needs an MCP Apps-compatible host to search.";
  }
});
void app.connect().catch(() => {
  status.textContent = "Open this view through an MCP Apps-compatible chat host.";
});
