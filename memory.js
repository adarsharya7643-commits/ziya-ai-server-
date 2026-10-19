const fs = require("fs");
const path = require("path");

const MEMORY_FILE = path.join(__dirname, "memory.json");

function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      fs.writeFileSync(MEMORY_FILE, "[]");
      return [];
    }

    const data = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));

    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveMemory(memory) {
  fs.writeFileSync(
    MEMORY_FILE,
    JSON.stringify(memory, null, 2),
    "utf8"
  );
}

function addMemory(text) {
  const memory = loadMemory();

  const clean = text.trim();

  if (!clean) return false;

  const exists = memory.some(
    item => item.toLowerCase() === clean.toLowerCase()
  );

  if (exists) return false;

  memory.push(clean);
  saveMemory(memory);

  return true;
}

function getMemories() {
  return loadMemory();
}

function forgetMemory(searchText) {
  const memory = loadMemory();

  const lower = searchText.toLowerCase();

  const filtered = memory.filter(
    item => !item.toLowerCase().includes(lower)
  );

  const removed = memory.length - filtered.length;

  saveMemory(filtered);

  return removed;
}

module.exports = {
  addMemory,
  getMemories,
  forgetMemory
};
