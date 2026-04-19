const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const modeSelect = document.getElementById("mode");
const button = form.querySelector("button");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;
  const mode = modeSelect.value;

  button.disabled = true;
  statusEl.textContent = "Loading...";
  resultsEl.textContent = "";

  const started = performance.now();
  try {
    const response = await fetch(`/search/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const elapsed = (performance.now() - started) / 1000;
    const text = await response.text();
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch (_) {}
    statusEl.textContent = response.ok
      ? `Done in ${elapsed.toFixed(3)}s`
      : `Error ${response.status} in ${elapsed.toFixed(3)}s`;
    resultsEl.textContent = pretty;
  } catch (err) {
    const elapsed = (performance.now() - started) / 1000;
    statusEl.textContent = `Failed in ${elapsed.toFixed(3)}s`;
    resultsEl.textContent = String(err);
  } finally {
    button.disabled = false;
  }
});
