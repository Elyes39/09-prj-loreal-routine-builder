/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateBtn = document.getElementById("generateRoutine");
const clearSelectedBtn = document.getElementById("clearSelected");

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Cloudflare Worker endpoint (provided) */
const WORKER_URL = "https://loreal-chatbot-worker.seffar-elyes.workers.dev/";

/* App state */
let productsData = [];
let selectedIds = new Set();
let messages = []; // conversation history for chat (OpenAI-style messages)

const STORAGE_KEY = "loreal_selected_ids_v1";

/* Initialize app */
async function init() {
  productsData = await loadProducts();
  loadSelectionsFromStorage();
  // If a category is already selected in the dropdown, show it
  if (categoryFilter.value) {
    const filtered = productsData.filter(
      (p) => p.category === categoryFilter.value
    );
    displayProducts(filtered);
  }
}

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map((product) => {
      const isSelected = selectedIds.has(String(product.id));
      return `
      <div class="product-card ${isSelected ? "selected" : ""}" data-id="${
        product.id
      }">
        <img src="${product.image}" alt="${product.name}">
        <div class="product-info">
          <h3>${product.name}</h3>
          <p class="brand">${product.brand}</p>
          <button class="details-btn" aria-expanded="false">Details</button>
          <div class="description" hidden>${product.description}</div>
        </div>
      </div>
    `;
    })
    .join("");
}

/* Utility: find product by id */
function findProductById(id) {
  return productsData.find((p) => String(p.id) === String(id));
}

/* Selection persistence */
function saveSelectionsToStorage() {
  const arr = Array.from(selectedIds);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

function loadSelectionsFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const arr = JSON.parse(raw);
    arr.forEach((id) => selectedIds.add(String(id)));
    renderSelectedList();
  } catch (e) {
    console.warn("Could not load selections", e);
  }
}

function renderSelectedList() {
  if (selectedIds.size === 0) {
    selectedProductsList.innerHTML = "<em>No products selected</em>";
    return;
  }

  selectedProductsList.innerHTML = Array.from(selectedIds)
    .map((id) => {
      const p = findProductById(id);
      if (!p) return "";
      return `
      <div class="selected-chip" data-id="${p.id}">
        ${p.name} <button aria-label="Remove ${p.name}" class="remove-chip">&times;</button>
      </div>
    `;
    })
    .join("");
}

function clearAllSelections() {
  selectedIds.clear();
  saveSelectionsToStorage();
  renderSelectedList();
  // refresh visible grid to remove highlights
  if (categoryFilter.value) {
    displayProducts(
      productsData.filter((p) => p.category === categoryFilter.value)
    );
  }
}

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  const selectedCategory = e.target.value;
  const filteredProducts = productsData.filter(
    (product) => product.category === selectedCategory
  );
  displayProducts(filteredProducts);
});

/* Chat form submission handler - placeholder for OpenAI integration */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;

  appendMessage("user", text);
  messages.push({ role: "user", content: text });
  input.value = "";

  // Send to Worker with conversation and selected products context
  sendMessageToWorker()
    .then((reply) => {
      appendMessage("assistant", reply);
      messages.push({ role: "assistant", content: reply });
    })
    .catch((err) => {
      appendMessage("assistant", "Sorry, something went wrong.");
      console.error(err);
    });
});

/* Product card interactions (delegation) */
productsContainer.addEventListener("click", (e) => {
  const detailsBtn = e.target.closest(".details-btn");
  if (detailsBtn) {
    const card = detailsBtn.closest(".product-card");
    const desc = card.querySelector(".description");
    const expanded = detailsBtn.getAttribute("aria-expanded") === "true";
    detailsBtn.setAttribute("aria-expanded", String(!expanded));
    if (expanded) {
      desc.hidden = true;
    } else {
      desc.hidden = false;
    }
    return;
  }

  const card = e.target.closest(".product-card");
  if (!card) return;
  const id = card.getAttribute("data-id");
  toggleSelection(id);
  card.classList.toggle("selected", selectedIds.has(String(id)));
  renderSelectedList();
  saveSelectionsToStorage();
});

// Remove buttons on selected list (delegation)
selectedProductsList.addEventListener("click", (e) => {
  const btn = e.target.closest(".remove-chip");
  if (!btn) return;
  const chip = btn.closest(".selected-chip");
  const id = chip.getAttribute("data-id");
  selectedIds.delete(String(id));
  saveSelectionsToStorage();
  renderSelectedList();
  // update grid visuals if visible
  if (categoryFilter.value)
    displayProducts(
      productsData.filter((p) => p.category === categoryFilter.value)
    );
});

clearSelectedBtn.addEventListener("click", () => {
  clearAllSelections();
});

function toggleSelection(id) {
  id = String(id);
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
}

function appendMessage(role, text) {
  const el = document.createElement("div");
  el.className = "message " + (role === "user" ? "user" : "assistant");
  el.textContent = text;
  chatWindow.appendChild(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Send conversation + selected products to Worker and return assistant reply text */
async function sendMessageToWorker() {
  const selected = Array.from(selectedIds)
    .map((id) => findProductById(id))
    .filter(Boolean)
    .map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      category: p.category,
      description: p.description,
    }));

  const body = {
    messages: messages,
    products: selected,
  };

  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error("Worker error: " + text);
  }

  const data = await res.json();
  // Try to find assistant text in common shapes
  if (
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content
  ) {
    return data.choices[0].message.content;
  }
  if (data.reply) return data.reply;
  if (typeof data === "string") return data;
  // fallback: stringify
  return JSON.stringify(data);
}

/* Generate routine button handler */
generateBtn.addEventListener("click", async () => {
  const selected = Array.from(selectedIds);
  if (selected.length === 0) {
    alert("Please select at least one product to generate a routine.");
    return;
  }

  // Add a short system message to guide the assistant for routine generation
  messages.push({
    role: "system",
    content:
      "You are a helpful beauty advisor. Create a concise step-by-step routine using the provided products. Be specific about order of use and helpful tips. Keep it friendly and clear.",
  });
  messages.push({
    role: "user",
    content:
      "Create a personalized routine using the selected products below. Mention a morning/evening split if relevant and note any compatibility cautions.",
  });

  appendMessage("assistant", "Generating routine...");

  try {
    const reply = await sendMessageToWorker();
    // remove the 'Generating routine...' placeholder
    const last = chatWindow.querySelector(".message.assistant:last-child");
    if (last && last.textContent === "Generating routine...") last.remove();

    appendMessage("assistant", reply);
    messages.push({ role: "assistant", content: reply });
  } catch (err) {
    console.error(err);
    appendMessage(
      "assistant",
      "Sorry — I could not generate the routine right now."
    );
  }
});

// Start the app
init();
