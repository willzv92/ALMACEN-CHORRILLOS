// ============================================================
//  ALMACÉN ARQCOPY CHORRILLOS — app.js v2
//  + Campo Unidad | Ordenamiento por columnas | Alertas stock
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ══════════════════════════════════════════════════════════════
//  🔥 CONFIGURACIÓN FIREBASE
//  → Ve a https://console.firebase.google.com
//  → Crea un proyecto → Web App → pega tu firebaseConfig aquí
// ══════════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey:            "AIzaSyDen4BCgxRR6aUdG1WnZ5vv4uF_ZLlE2yo",
  authDomain:        "almacen-chorrillos.firebaseapp.com",
  databaseURL:       "https://almacen-chorrillos-default-rtdb.firebaseio.com",
  projectId:         "almacen-chorrillos",
  storageBucket:     "almacen-chorrillos.firebasestorage.app",
  messagingSenderId: "556739627538",
  appId:             "1:556739627538:web:fe35a4fed31b5ec067a6cb",
  measurementId:     "G-FFZ0H8EBWY"
};

const isConfigured = !firebaseConfig.apiKey.startsWith("TU_");

let db = null;
let prodCollection = null;

// Cache de todos los productos (para ordenar/filtrar sin re-fetch)
let allProducts = [];

// Estado local (fallback sin Firebase)
let localProducts = JSON.parse(localStorage.getItem("arqcopy_products") || "[]");

// Ordenamiento: por defecto cantidad ASC (menos stock primero)
let sortCol = "cantidad";
let sortDir = "asc";   // "asc" | "desc"

// Umbral de stock bajo
const LOW_STOCK_THRESHOLD = 5;

// IDs de productos ya alertados (para no repetir popup en cada render)
const alertedIds = new Set();

// ── DOM refs ──────────────────────────────────────────────────
const inputNombre   = document.getElementById("prod-nombre");
const inputMarca    = document.getElementById("prod-marca");
const inputUnidad   = document.getElementById("prod-unidad");
const inputCantidad = document.getElementById("prod-cantidad");
const inputTotal    = document.getElementById("prod-total");
const btnAdd        = document.getElementById("btn-add");
const btnClear      = document.getElementById("btn-clear");

const selProducto   = document.getElementById("mov-producto");
const inputMovQty   = document.getElementById("mov-cantidad");
const btnEntrada    = document.getElementById("btn-entrada");
const btnSalida     = document.getElementById("btn-salida");

const tableBody     = document.getElementById("table-body");
const emptyState    = document.getElementById("empty-state");
const searchInput   = document.getElementById("search-input");

const modalDelete   = document.getElementById("modal-delete");
const modalCancel   = document.getElementById("modal-cancel");
const modalConfirm  = document.getElementById("modal-confirm");

const modalAlert      = document.getElementById("modal-alert");
const modalAlertClose = document.getElementById("modal-alert-close");
const alertList       = document.getElementById("alert-list");

const statProducts  = document.getElementById("total-products");
const statStock     = document.getElementById("total-stock");
const lowStockPill  = document.getElementById("low-stock-pill");
const lowStockCount = document.getElementById("low-stock-count");

const toast         = document.getElementById("toast");

let deleteTargetId  = null;
let currentFilter   = "";

// ══════════════════════════════════════════════════════════════
//  INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════
async function init() {
  setupSortableHeaders();
  setupAlertModal();

  if (isConfigured) {
    try {
      const app = initializeApp(firebaseConfig);
      db = getFirestore(app);
      prodCollection = collection(db, "productos");
      subscribeFirestore();
      showToast("🔥 Conectado a Firebase", "success");
    } catch (err) {
      console.error("Firebase error:", err);
      showToast("⚠️ Error Firebase. Modo local activado.", "warning");
      allProducts = localProducts;
      renderTable();
    }
  } else {
    showConfigWarning();
    allProducts = localProducts;
    renderTable();
  }
}

// ── Suscripción en tiempo real Firestore ──────────────────────
function subscribeFirestore() {
  onSnapshot(prodCollection, (snapshot) => {
    allProducts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // Rellena fechas faltantes en documentos que existían antes de esta versión
    const now = nowISO();
    snapshot.docs.forEach(d => {
      const data = d.data();
      const updates = {};
      if (!data.fechaEntrada) updates.fechaEntrada = now;
      if (!data.fechaSalida)  updates.fechaSalida  = "—";
      if (Object.keys(updates).length > 0) {
        updateDoc(doc(db, "productos", d.id), updates).catch(console.error);
      }
    });

    renderTable();
    checkLowStock();
  }, (err) => {
    console.error("Firestore onSnapshot error:", err);
    showToast("⚠️ Error de conexión con Firebase", "error");
  });
}

// ══════════════════════════════════════════════════════════════
//  CRUD
// ══════════════════════════════════════════════════════════════
function nowISO() {
  return new Date().toISOString();
}

function fmtDate(val) {
  // Nulo, undefined o el literal "—"
  if (!val || val === "—") return "—";
  try {
    let d;
    if (val.toDate) {
      // Firestore Timestamp
      d = val.toDate();
    } else if (typeof val === "object" && val.seconds) {
      // Firestore Timestamp serializado { seconds, nanoseconds }
      d = new Date(val.seconds * 1000);
    } else {
      // ISO string
      d = new Date(val);
    }
    if (isNaN(d.getTime())) return "—";
    const fecha = d.toLocaleDateString("es-PE", { day:"2-digit", month:"2-digit", year:"numeric" });
    const hora  = d.toLocaleTimeString("es-PE", { hour:"2-digit", minute:"2-digit" });
    return `${fecha} ${hora}`;
  } catch { return "—"; }
}

async function addProduct(data) {
  const now = nowISO();
  if (isConfigured && db) {
    await addDoc(prodCollection, {
      ...data,
      fechaEntrada: now,
      fechaSalida:  "—",
      createdAt:    serverTimestamp()
    });
  } else {
    data.id          = Date.now().toString();
    data.fechaEntrada = now;
    data.fechaSalida  = "—";
    localProducts.push(data);
    allProducts = [...localProducts];
    saveLocal();
    renderTable();
    checkLowStock();
  }
}

async function updateProduct(id, updates) {
  if (isConfigured && db) {
    await updateDoc(doc(db, "productos", id), updates);
  } else {
    const idx = localProducts.findIndex(p => p.id === id);
    if (idx !== -1) {
      localProducts[idx] = { ...localProducts[idx], ...updates };
      allProducts = [...localProducts];
      saveLocal();
      renderTable();
      checkLowStock();
    }
  }
}

async function deleteProduct(id) {
  if (isConfigured && db) {
    await deleteDoc(doc(db, "productos", id));
  } else {
    localProducts = localProducts.filter(p => p.id !== id);
    allProducts   = [...localProducts];
    alertedIds.delete(id);
    saveLocal();
    renderTable();
    checkLowStock();
  }
}

function saveLocal() {
  localStorage.setItem("arqcopy_products", JSON.stringify(localProducts));
}

// ══════════════════════════════════════════════════════════════
//  ORDENAMIENTO
// ══════════════════════════════════════════════════════════════
function setupSortableHeaders() {
  document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortCol = col;
        sortDir = "asc";
      }
      updateSortIcons();
      renderTable();
    });
  });
}

function updateSortIcons() {
  document.querySelectorAll("th.sortable").forEach(th => {
    const icon = th.querySelector(".sort-icon");
    th.classList.remove("active", "asc", "desc");
    icon.className = "fas fa-sort sort-icon";
    if (th.dataset.col === sortCol) {
      th.classList.add("active", sortDir);
      icon.className = `fas fa-sort-${sortDir === "asc" ? "up" : "down"} sort-icon`;
    }
  });
}

function getStatusOrder(qty) {
  if (qty === 0) return 0;
  if (qty <= LOW_STOCK_THRESHOLD) return 1;
  return 2;
}

function sortProducts(products) {
  return [...products].sort((a, b) => {
    let va, vb;
    switch (sortCol) {
      case "nombre":
        va = (a.nombre || "").toLowerCase();
        vb = (b.nombre || "").toLowerCase();
        break;
      case "marca":
        va = (a.marca || "").toLowerCase();
        vb = (b.marca || "").toLowerCase();
        break;
      case "cantidad":
        va = Number(a.cantidad) || 0;
        vb = Number(b.cantidad) || 0;
        break;
      case "total":
        va = Number(a.total) || 0;
        vb = Number(b.total) || 0;
        break;
      case "estado":
        va = getStatusOrder(Number(a.cantidad) || 0);
        vb = getStatusOrder(Number(b.cantidad) || 0);
        break;
      default:
        va = 0; vb = 0;
    }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ?  1 : -1;
    return 0;
  });
}

// ══════════════════════════════════════════════════════════════
//  ALERTAS STOCK BAJO
// ══════════════════════════════════════════════════════════════
function checkLowStock() {
  const lowItems = allProducts.filter(p => (Number(p.cantidad) || 0) <= LOW_STOCK_THRESHOLD);
  const newAlerts = lowItems.filter(p => !alertedIds.has(p.id));

  // Actualizar pill del header
  if (lowItems.length > 0) {
    lowStockPill.style.display = "flex";
    lowStockCount.textContent  = lowItems.length;
  } else {
    lowStockPill.style.display = "none";
  }

  // Mostrar popup solo para productos recién detectados
  if (newAlerts.length > 0) {
    newAlerts.forEach(p => alertedIds.add(p.id));
    showAlertModal(newAlerts);
  }

  // Si un producto ya fue repuesto, sacar del set para que vuelva a alertar si baja de nuevo
  const lowIds = new Set(lowItems.map(p => p.id));
  for (const id of alertedIds) {
    if (!lowIds.has(id)) alertedIds.delete(id);
  }
}

function showAlertModal(items) {
  alertList.innerHTML = items.map(p => {
    const qty  = Number(p.cantidad) || 0;
    const cls  = qty === 0 ? "alert-item empty" : "alert-item";
    return `
      <div class="${cls}">
        <div class="alert-item-info">
          <div class="alert-item-name">${escHtml(p.nombre)}</div>
          <div class="alert-item-brand">${escHtml(p.marca)}</div>
        </div>
        <div class="alert-item-qty">
          <div class="qty-num">${qty}</div>
          <div class="qty-unit">${escHtml(p.unidad || "unid")}</div>
        </div>
      </div>`;
  }).join("");
  modalAlert.style.display = "flex";
}

function setupAlertModal() {
  modalAlertClose.addEventListener("click", () => {
    modalAlert.style.display = "none";
  });
  modalAlert.addEventListener("click", (e) => {
    if (e.target === modalAlert) modalAlert.style.display = "none";
  });
  // Pill clickable para ver alerta en cualquier momento
  lowStockPill.addEventListener("click", () => {
    const lowItems = allProducts.filter(p => (Number(p.cantidad) || 0) <= LOW_STOCK_THRESHOLD);
    if (lowItems.length) showAlertModal(lowItems);
  });
}

// ══════════════════════════════════════════════════════════════
//  RENDER TABLA
// ══════════════════════════════════════════════════════════════
function renderTable() {
  // Filtrar
  let filtered = currentFilter
    ? allProducts.filter(p =>
        (p.nombre || "").toLowerCase().includes(currentFilter) ||
        (p.marca  || "").toLowerCase().includes(currentFilter)
      )
    : allProducts;

  // Ordenar
  filtered = sortProducts(filtered);

  // Stats
  statProducts.textContent = allProducts.length;
  statStock.textContent    = allProducts.reduce((s, p) => s + (Number(p.cantidad) || 0), 0);

  populateSelect(allProducts);

  if (filtered.length === 0) {
    tableBody.innerHTML = "";
    emptyState.classList.add("visible");
    return;
  }
  emptyState.classList.remove("visible");

  tableBody.innerHTML = filtered.map((p, i) => {
    const qty   = Number(p.cantidad) || 0;
    const total = Number(p.total)    || 0;
    const unit  = p.unidad || "unid";

    const badge = qty === 0
      ? `<span class="badge badge-empty">Sin stock</span>`
      : qty <= LOW_STOCK_THRESHOLD
        ? `<span class="badge badge-low">Stock bajo</span>`
        : `<span class="badge badge-ok">Disponible</span>`;

    const rowClass = qty === 0
      ? "row-animate row-critical"
      : qty <= LOW_STOCK_THRESHOLD
        ? "row-animate row-low"
        : "row-animate";

    return `
      <tr class="${rowClass}" data-id="${p.id}">
        <td class="td-number">${i + 1}</td>
        <td class="td-product">${escHtml(p.nombre)}</td>
        <td class="td-brand">${escHtml(p.marca)}</td>
        <td class="td-qty">${qty}</td>
        <td class="td-unit">${escHtml(unit)}</td>
        <td class="td-total">S/. ${total.toFixed(2)}</td>
        <td class="td-date">${fmtDate(p.fechaEntrada)}</td>
        <td class="td-date">${fmtDate(p.fechaSalida)}</td>
        <td>${badge}</td>
        <td class="action-cell">
          <button class="btn btn-icon" title="Entrada rápida +1" onclick="quickMove('${p.id}', 1)">
            <i class="fas fa-plus"></i>
          </button>
          <button class="btn btn-icon edit" title="Editar producto" onclick="openEditModal('${p.id}')">
            <i class="fas fa-pen"></i>
          </button>
          <button class="btn btn-icon del" title="Eliminar" onclick="askDelete('${p.id}')">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>`;
  }).join("");
}

function populateSelect(products) {
  const current = selProducto.value;
  selProducto.innerHTML = `<option value="">-- Seleccionar --</option>` +
    products.map(p =>
      `<option value="${p.id}">${escHtml(p.nombre)} (${p.cantidad} ${p.unidad || "unid"})</option>`
    ).join("");
  if (current) selProducto.value = current;
}

// ══════════════════════════════════════════════════════════════
//  EVENTOS
// ══════════════════════════════════════════════════════════════

// Guardar nuevo producto
btnAdd.addEventListener("click", async () => {
  if (btnAdd.disabled) return;

  const nombre   = inputNombre.value.trim();
  const marca    = inputMarca.value.trim();
  const unidad   = inputUnidad.value;
  const cantidad = parseInt(inputCantidad.value) || 0;
  const total    = parseFloat(inputTotal.value)  || 0;

  if (!nombre) { showToast("Ingresa el nombre del producto", "error"); inputNombre.focus(); return; }
  if (!marca)  { showToast("Ingresa la marca", "error"); inputMarca.focus(); return; }

  const enableBtn = () => { btnAdd.disabled = false; btnAdd.style.opacity = "1"; };
  const safetyTimer = setTimeout(enableBtn, 8000);

  btnAdd.disabled      = true;
  btnAdd.style.opacity = "0.6";

  try {
    await addProduct({ nombre, marca, unidad, cantidad, total });
    inputNombre.value   = "";
    inputMarca.value    = "";
    inputCantidad.value = "";
    inputTotal.value    = "";
    inputUnidad.value   = "pza";
    inputNombre.focus();
    showToast("✅ Producto guardado correctamente", "success");
  } catch (err) {
    console.error("Error guardando producto:", err);
    showToast("Error al guardar el producto", "error");
  } finally {
    clearTimeout(safetyTimer);
    enableBtn();
  }
});

// Limpiar formulario
btnClear.addEventListener("click", () => {
  inputNombre.value   = "";
  inputMarca.value    = "";
  inputUnidad.value   = "pza";
  inputCantidad.value = "";
  inputTotal.value    = "";
  inputNombre.focus();
  showToast("🧹 Campos limpiados", "info");
});

// Movimientos
btnEntrada.addEventListener("click", () => movimiento("entrada"));
btnSalida.addEventListener("click",  () => movimiento("salida"));

async function movimiento(tipo) {
  const id  = selProducto.value;
  const qty = parseInt(inputMovQty.value) || 0;

  if (!id)     { showToast("Selecciona un producto", "error"); return; }
  if (qty <= 0){ showToast("Ingresa una cantidad válida", "error"); return; }

  const producto = allProducts.find(p => p.id === id);
  if (!producto) { showToast("Producto no encontrado", "error"); return; }

  const cantActual = Number(producto.cantidad) || 0;

  if (tipo === "salida" && qty > cantActual) {
    showToast(`⚠️ Stock insuficiente (disponible: ${cantActual} ${producto.unidad || "unid"})`, "warning");
    return;
  }

  const nuevaCant = tipo === "entrada" ? cantActual + qty : cantActual - qty;
  const fechaUpdate = tipo === "entrada"
    ? { cantidad: nuevaCant, fechaEntrada: nowISO() }
    : { cantidad: nuevaCant, fechaSalida:  nowISO() };

  try {
    await updateProduct(id, fechaUpdate);
    inputMovQty.value = "";
    const unit = producto.unidad || "unid";
    showToast(
      tipo === "entrada"
        ? `📦 Entrada de ${qty} ${unit} registrada`
        : `📤 Salida de ${qty} ${unit} registrada`,
      tipo === "entrada" ? "success" : "warning"
    );
  } catch (err) {
    showToast("Error al registrar movimiento", "error");
  }
}

// Movimiento rápido +1 desde tabla
window.quickMove = async function(id, delta) {
  const producto = allProducts.find(p => p.id === id);
  if (!producto) return;
  const nuevaCant = Math.max(0, (Number(producto.cantidad) || 0) + delta);
  const fechaUpdate = delta > 0
    ? { cantidad: nuevaCant, fechaEntrada: nowISO() }
    : { cantidad: nuevaCant, fechaSalida:  nowISO() };
  await updateProduct(id, fechaUpdate);
  showToast(delta > 0 ? "📦 +1 registrado" : "📤 -1 registrado", "success");
};

// Búsqueda
searchInput.addEventListener("input", () => {
  currentFilter = searchInput.value.trim().toLowerCase();
  renderTable();
});

// ══════════════════════════════════════════════════════════════
//  MODAL ELIMINAR
// ══════════════════════════════════════════════════════════════
window.askDelete = function(id) {
  deleteTargetId = id;
  modalDelete.style.display = "flex";
};

modalCancel.addEventListener("click", () => {
  modalDelete.style.display = "none";
  deleteTargetId = null;
});

modalConfirm.addEventListener("click", async () => {
  if (!deleteTargetId) return;
  try {
    await deleteProduct(deleteTargetId);
    showToast("🗑️ Producto eliminado", "warning");
  } catch (err) {
    showToast("Error al eliminar", "error");
  } finally {
    modalDelete.style.display = "none";
    deleteTargetId = null;
  }
});

modalDelete.addEventListener("click", (e) => {
  if (e.target === modalDelete) {
    modalDelete.style.display = "none";
    deleteTargetId = null;
  }
});

// ══════════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════════
let toastTimer = null;
function showToast(msg, type = "info") {
  toast.textContent = msg;
  toast.className   = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

// ══════════════════════════════════════════════════════════════
//  CONFIG WARNING
// ══════════════════════════════════════════════════════════════
function showConfigWarning() {
  const warning = document.createElement("div");
  warning.className = "config-warning visible";
  warning.innerHTML = `
    ⚠️ <strong>Firebase no configurado.</strong> Datos guardados localmente.
    Para multi-dispositivo, edita <code>app.js</code> con tu
    <a href="https://console.firebase.google.com" target="_blank">Firebase config</a>.
  `;
  document.querySelector(".panel-form").prepend(warning);
}

// ══════════════════════════════════════════════════════════════
//  HELPER
// ══════════════════════════════════════════════════════════════
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init();

// ══════════════════════════════════════════════════════════════
//  EXPORTAR / IMPORTAR BASE DE DATOS
// ══════════════════════════════════════════════════════════════

// ── Referencias DOM ───────────────────────────────────────────
const btnExport        = document.getElementById("btn-export");
const importFile       = document.getElementById("import-file");
const modalImport      = document.getElementById("modal-import");
const importSummary    = document.getElementById("import-summary");
const modalImportCancel  = document.getElementById("modal-import-cancel");
const modalImportConfirm = document.getElementById("modal-import-confirm");

let pendingImportData = [];   // productos listos para importar

// ── EXPORTAR → descarga un .json con todos los productos ──────
btnExport.addEventListener("click", () => {
  if (allProducts.length === 0) {
    showToast("No hay productos para exportar", "warning");
    return;
  }

  // Limpiar campos internos de Firebase antes de exportar
  const clean = allProducts.map(({ id, createdAt, ...rest }) => rest);

  const payload = {
    exportedAt: new Date().toISOString(),
    source:     "Almacén ArqCopy Chorrillos",
    version:    "1.0",
    total:      clean.length,
    productos:  clean
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `arqcopy-inventario-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`📥 Exportados ${clean.length} productos`, "success");
});

// ── IMPORTAR → lee el archivo .json seleccionado ──────────────
importFile.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);

      // Acepta tanto formato completo { productos: [...] } como array directo [...]
      const lista = Array.isArray(data)
        ? data
        : Array.isArray(data.productos)
          ? data.productos
          : null;

      if (!lista || lista.length === 0) {
        showToast("El archivo no contiene productos válidos", "error");
        return;
      }

      // Validar que cada item tenga al menos nombre
      const validos = lista.filter(p => p && typeof p.nombre === "string" && p.nombre.trim());
      if (validos.length === 0) {
        showToast("Ningún producto tiene el campo 'nombre'", "error");
        return;
      }

      pendingImportData = validos;
      importSummary.textContent =
        `Se encontraron ${validos.length} producto(s) en el archivo. ¿Cómo deseas importarlos?`;
      modalImport.style.display = "flex";

    } catch {
      showToast("❌ Archivo JSON inválido o corrupto", "error");
    } finally {
      importFile.value = ""; // reset para poder seleccionar el mismo archivo otra vez
    }
  };
  reader.readAsText(file);
});

// ── Cancelar importación ──────────────────────────────────────
modalImportCancel.addEventListener("click", () => {
  modalImport.style.display = "none";
  pendingImportData = [];
});
modalImport.addEventListener("click", (e) => {
  if (e.target === modalImport) {
    modalImport.style.display = "none";
    pendingImportData = [];
  }
});

// ── Confirmar importación ─────────────────────────────────────
modalImportConfirm.addEventListener("click", async () => {
  const mode = document.querySelector('input[name="import-mode"]:checked').value;
  modalImport.style.display = "none";

  if (pendingImportData.length === 0) return;

  modalImportConfirm.disabled = true;
  showToast("⏳ Importando productos...", "info");

  try {
    // MODO REEMPLAZAR: eliminar todos los productos actuales primero
    if (mode === "replace") {
      if (isConfigured && db) {
        const delPromises = allProducts.map(p => deleteDoc(doc(db, "productos", p.id)));
        await Promise.all(delPromises);
      } else {
        localProducts = [];
        alertedIds.clear();
      }
    }

    // Normalizar y subir cada producto
    const campos = ["nombre", "marca", "unidad", "cantidad", "total"];
    const addPromises = pendingImportData.map(p => {
      const clean = {};
      campos.forEach(k => {
        if (p[k] !== undefined) clean[k] = p[k];
      });
      // Valores por defecto si faltan campos
      clean.nombre   = (clean.nombre   || "Sin nombre").trim();
      clean.marca    = (clean.marca    || "Sin marca").trim();
      clean.unidad   = (clean.unidad   || "unid");
      clean.cantidad = Number(clean.cantidad) || 0;
      clean.total    = Number(clean.total)    || 0;

      return addProduct(clean);
    });

    await Promise.all(addPromises);

    showToast(
      `✅ ${pendingImportData.length} productos importados (${mode === "replace" ? "reemplazando" : "combinando"})`,
      "success"
    );
  } catch (err) {
    console.error("Import error:", err);
    showToast("❌ Error durante la importación", "error");
  } finally {
    modalImportConfirm.disabled = false;
    pendingImportData = [];
  }
});

// ══════════════════════════════════════════════════════════════
//  SELECCIÓN DE PRODUCTOS + GENERACIÓN DE PDF
// ══════════════════════════════════════════════════════════════

const selectionBar   = document.getElementById("selection-bar");
const selCount       = document.getElementById("sel-count");
const btnSelAll      = document.getElementById("btn-sel-all");
const btnSelNone     = document.getElementById("btn-sel-none");
const btnPdf         = document.getElementById("btn-pdf");
const chkAll         = document.getElementById("chk-all");

const modalPdf       = document.getElementById("modal-pdf");
const pdfSummary     = document.getElementById("pdf-summary");
const pdfTitleInput  = document.getElementById("pdf-title");
const pdfNoteInput   = document.getElementById("pdf-note");
const modalPdfCancel = document.getElementById("modal-pdf-cancel");
const modalPdfConfirm= document.getElementById("modal-pdf-confirm");

// Set de IDs seleccionados
const selectedIds = new Set();

// ── Actualizar UI de selección ────────────────────────────────
function updateSelectionUI() {
  const count = selectedIds.size;
  selCount.textContent = count;

  if (count > 0) {
    selectionBar.style.display = "flex";
  } else {
    selectionBar.style.display = "none";
  }

  // Sincronizar checkbox "seleccionar todos"
  const visibleRows = tableBody.querySelectorAll("tr[data-id]");
  const allChecked  = visibleRows.length > 0 &&
    [...visibleRows].every(r => selectedIds.has(r.dataset.id));
  chkAll.checked       = allChecked;
  chkAll.indeterminate = count > 0 && !allChecked;

  // Resaltar filas seleccionadas
  visibleRows.forEach(row => {
    row.classList.toggle("selected", selectedIds.has(row.dataset.id));
    const chk = row.querySelector(".row-chk");
    if (chk) chk.checked = selectedIds.has(row.dataset.id);
  });
}

// ── Checkbox "Seleccionar todos" ──────────────────────────────
chkAll.addEventListener("change", () => {
  const visibleRows = tableBody.querySelectorAll("tr[data-id]");
  if (chkAll.checked) {
    visibleRows.forEach(r => selectedIds.add(r.dataset.id));
  } else {
    visibleRows.forEach(r => selectedIds.delete(r.dataset.id));
  }
  updateSelectionUI();
});

// ── Botones Todos / Ninguno ───────────────────────────────────
btnSelAll.addEventListener("click", () => {
  allProducts.forEach(p => selectedIds.add(p.id));
  updateSelectionUI();
});

btnSelNone.addEventListener("click", () => {
  selectedIds.clear();
  updateSelectionUI();
});

// ── Click en fila (delegar desde tbody) ───────────────────────
tableBody.addEventListener("change", (e) => {
  if (!e.target.classList.contains("row-chk")) return;
  const row = e.target.closest("tr[data-id]");
  if (!row) return;
  if (e.target.checked) {
    selectedIds.add(row.dataset.id);
  } else {
    selectedIds.delete(row.dataset.id);
  }
  updateSelectionUI();
});

// ── Parchar renderTable para agregar checkbox en cada fila ────
//    Sobreescribimos window._origRenderRow para insertar la celda
const _origRenderTable = renderTable;

// Monkey-patch: tras cada render añadimos checkbox column
function patchRowsWithCheckbox() {
  tableBody.querySelectorAll("tr[data-id]").forEach(row => {
    if (row.querySelector(".td-check")) return; // ya tiene
    const td = document.createElement("td");
    td.className = "td-check";
    const chk = document.createElement("input");
    chk.type      = "checkbox";
    chk.className = "row-chk";
    chk.checked   = selectedIds.has(row.dataset.id);
    td.appendChild(chk);
    row.insertBefore(td, row.firstChild);
    row.classList.toggle("selected", selectedIds.has(row.dataset.id));
  });
  updateSelectionUI();
}

// Observar cambios en tbody para parchar checkboxes automáticamente
const tbodyObserver = new MutationObserver(() => patchRowsWithCheckbox());
tbodyObserver.observe(tableBody, { childList: true });

// ── Abrir modal PDF ───────────────────────────────────────────
btnPdf.addEventListener("click", () => {
  if (selectedIds.size === 0) {
    showToast("Selecciona al menos un producto", "warning");
    return;
  }
  pdfSummary.textContent = `${selectedIds.size} producto(s) seleccionado(s)`;
  modalPdf.style.display = "flex";
});

modalPdfCancel.addEventListener("click", () => { modalPdf.style.display = "none"; });
modalPdf.addEventListener("click", (e) => { if (e.target === modalPdf) modalPdf.style.display = "none"; });

// ── Generar PDF ───────────────────────────────────────────────
modalPdfConfirm.addEventListener("click", () => {
  const titulo = pdfTitleInput.value.trim() || "Inventario ArqCopy";
  const nota   = pdfNoteInput.value.trim();

  // Columnas activas (el checkbox de "nombre" siempre está incluido)
  const colsActivas = [...document.querySelectorAll(".pdf-col-chk:checked")].map(c => c.value);

  // Productos seleccionados en el orden actual de la tabla
  const productos = sortProducts(allProducts).filter(p => selectedIds.has(p.id));

  if (productos.length === 0) {
    showToast("No hay productos para exportar", "warning");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const PAGE_W  = 210;
  const MARGIN  = 14;
  const CONTENT = PAGE_W - MARGIN * 2;

  // ── Encabezado ──────────────────────────────────────────────
  // Franja azul superior
  doc.setFillColor(44, 100, 160);
  doc.rect(0, 0, PAGE_W, 22, "F");

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(titulo, MARGIN, 14);

  // Fecha en esquina derecha
  const fecha = new Date().toLocaleDateString("es-PE", {
    day: "2-digit", month: "long", year: "numeric"
  });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(fecha, PAGE_W - MARGIN, 14, { align: "right" });

  let cursorY = 28;

  // Nota / subtítulo
  if (nota) {
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(nota, MARGIN, cursorY);
    cursorY += 6;
  }

  // Resumen
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  doc.text(
    `Total de productos: ${productos.length}   |   Stock total: ${productos.reduce((s,p) => s + (Number(p.cantidad)||0), 0)}`,
    MARGIN, cursorY
  );
  cursorY += 5;

  // ── Definir columnas de la tabla ─────────────────────────────
  const colDefs = {
    nombre:       { header: "Producto",      dataKey: "nombre" },
    marca:        { header: "Marca",         dataKey: "marca" },
    unidad:       { header: "Unidad",        dataKey: "unidad" },
    cantidad:     { header: "Cantidad",      dataKey: "cantidad" },
    total:        { header: "Total (S/.)",   dataKey: "total" },
    fechaEntrada: { header: "Últ. Entrada",  dataKey: "fechaEntrada" },
    fechaSalida:  { header: "Últ. Salida",   dataKey: "fechaSalida" },
    estado:       { header: "Estado",        dataKey: "estado" },
  };

  const columns = colsActivas.map(k => colDefs[k]).filter(Boolean);

  const rows = productos.map((p, idx) => {
    const qty   = Number(p.cantidad) || 0;
    const total = Number(p.total)    || 0;
    const estado = qty === 0 ? "Sin stock" : qty <= LOW_STOCK_THRESHOLD ? "Stock bajo" : "Disponible";
    const row = { nombre: p.nombre, marca: p.marca, unidad: p.unidad || "unid",
                  cantidad: qty, total: `S/. ${total.toFixed(2)}`,
                  fechaEntrada: fmtDate(p.fechaEntrada), fechaSalida: fmtDate(p.fechaSalida),
                  estado };
    return colsActivas.reduce((acc, k) => { acc[k] = row[k]; return acc; }, {});
  });

  // ── autoTable ────────────────────────────────────────────────
  doc.autoTable({
    startY: cursorY + 2,
    columns,
    body: rows,
    margin: { left: MARGIN, right: MARGIN },
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: 3,
      textColor: [30, 30, 30],
      lineColor: [210, 220, 230],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [44, 100, 160],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
      halign: "center",
    },
    alternateRowStyles: { fillColor: [245, 248, 252] },
    columnStyles: {
      cantidad: { halign: "center" },
      total:    { halign: "right"  },
      estado:   { halign: "center" },
      unidad:   { halign: "center" },
    },
    didParseCell(data) {
      // Colorear estado
      if (data.column.dataKey === "estado" && data.section === "body") {
        const v = data.cell.raw;
        if (v === "Sin stock")  { data.cell.styles.textColor = [200, 60, 60];   data.cell.styles.fontStyle = "bold"; }
        if (v === "Stock bajo") { data.cell.styles.textColor = [180, 140, 0];   data.cell.styles.fontStyle = "bold"; }
        if (v === "Disponible") { data.cell.styles.textColor = [40, 140, 70];   data.cell.styles.fontStyle = "bold"; }
      }
    },
    didDrawPage(data) {
      // Pie de página
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(7.5);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Almacén ArqCopy Chorrillos  —  Página ${data.pageNumber} de ${pageCount}`,
        MARGIN, 290
      );
    }
  });

  // ── Guardar ──────────────────────────────────────────────────
  const safeName = titulo.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const dateStr  = new Date().toISOString().slice(0, 10);
  doc.save(`${safeName}_${dateStr}.pdf`);

  modalPdf.style.display = "none";
  showToast(`📄 PDF generado con ${productos.length} productos`, "success");
});

// ══════════════════════════════════════════════════════════════
//  MODAL EDITAR PRODUCTO
// ══════════════════════════════════════════════════════════════
const modalEdit        = document.getElementById("modal-edit");
const editSubtitle     = document.getElementById("edit-subtitle");
const editNombre       = document.getElementById("edit-nombre");
const editMarca        = document.getElementById("edit-marca");
const editUnidad       = document.getElementById("edit-unidad");
const editCantidad     = document.getElementById("edit-cantidad");
const editTotal        = document.getElementById("edit-total");
const modalEditCancel  = document.getElementById("modal-edit-cancel");
const modalEditConfirm = document.getElementById("modal-edit-confirm");

let editTargetId = null;

// Abrir modal con datos del producto
window.openEditModal = function(id) {
  const p = allProducts.find(p => p.id === id);
  if (!p) return;

  editTargetId        = id;
  editNombre.value    = p.nombre   || "";
  editMarca.value     = p.marca    || "";
  editUnidad.value    = p.unidad   || "pza";
  editCantidad.value  = p.cantidad ?? "";
  editTotal.value     = p.total    ?? "";
  editSubtitle.textContent = `Editando: ${p.nombre}`;

  modalEdit.style.display = "flex";
  setTimeout(() => editNombre.focus(), 100);
};

// Cerrar modal
modalEditCancel.addEventListener("click", () => {
  modalEdit.style.display = "none";
  editTargetId = null;
});
modalEdit.addEventListener("click", (e) => {
  if (e.target === modalEdit) {
    modalEdit.style.display = "none";
    editTargetId = null;
  }
});

// Guardar cambios
modalEditConfirm.addEventListener("click", async () => {
  if (!editTargetId) return;

  const nombre   = editNombre.value.trim();
  const marca    = editMarca.value.trim();
  const unidad   = editUnidad.value;
  const cantidad = parseFloat(editCantidad.value) || 0;
  const total    = parseFloat(editTotal.value)    || 0;

  if (!nombre) { showToast("El nombre no puede estar vacío", "error"); editNombre.focus(); return; }
  if (!marca)  { showToast("La marca no puede estar vacía", "error"); editMarca.focus(); return; }

  const enableBtn = () => { modalEditConfirm.disabled = false; modalEditConfirm.style.opacity = "1"; };
  modalEditConfirm.disabled     = true;
  modalEditConfirm.style.opacity = "0.6";

  try {
    await updateProduct(editTargetId, { nombre, marca, unidad, cantidad, total });
    showToast("✏️ Producto actualizado correctamente", "success");
    modalEdit.style.display = "none";
    editTargetId = null;
  } catch (err) {
    console.error("Error editando producto:", err);
    showToast("Error al guardar los cambios", "error");
  } finally {
    enableBtn();
  }
});

// Permitir guardar con Enter desde cualquier campo del modal
modalEdit.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) modalEditConfirm.click();
  if (e.key === "Escape") { modalEdit.style.display = "none"; editTargetId = null; }
});
