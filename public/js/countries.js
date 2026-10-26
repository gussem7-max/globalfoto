// public/js/countries.js
// Catálogo de países + dropdown con banderas (imagen, se ve en Windows/Mac/móvil)
// + chip de prefijo telefónico + ejemplo de número por país.

const COUNTRIES = [
  { iso:'VE', name:'Venezuela',        currency:'VES', dialCode:'+58',  channel:'pagomovil', example:'412 000 0000' },
  { iso:'CO', name:'Colombia',         currency:'COP', dialCode:'+57',  channel:'nequi',     example:'300 123 4567' },
  { iso:'US', name:'Estados Unidos',   currency:'USD', dialCode:'+1',   channel:'zinli' },
  { iso:'MX', name:'México',           currency:'USD', dialCode:'+52',  channel:'zinli' },
  { iso:'AR', name:'Argentina',        currency:'USD', dialCode:'+54',  channel:'zinli' },
  { iso:'CL', name:'Chile',            currency:'USD', dialCode:'+56',  channel:'zinli' },
  { iso:'PE', name:'Perú',             currency:'USD', dialCode:'+51',  channel:'zinli' },
  { iso:'EC', name:'Ecuador',          currency:'USD', dialCode:'+593', channel:'zinli' },
  { iso:'BO', name:'Bolivia',          currency:'USD', dialCode:'+591', channel:'zinli' },
  { iso:'PY', name:'Paraguay',         currency:'USD', dialCode:'+595', channel:'zinli' },
  { iso:'UY', name:'Uruguay',          currency:'USD', dialCode:'+598', channel:'zinli' },
  { iso:'BR', name:'Brasil',           currency:'USD', dialCode:'+55',  channel:'zinli' },
  { iso:'PA', name:'Panamá',           currency:'USD', dialCode:'+507', channel:'zinli' },
  { iso:'CR', name:'Costa Rica',       currency:'USD', dialCode:'+506', channel:'zinli' },
  { iso:'DO', name:'Rep. Dominicana',  currency:'USD', dialCode:'+1',   channel:'zinli' },
  { iso:'GT', name:'Guatemala',        currency:'USD', dialCode:'+502', channel:'zinli' },
  { iso:'HN', name:'Honduras',         currency:'USD', dialCode:'+504', channel:'zinli' },
  { iso:'SV', name:'El Salvador',      currency:'USD', dialCode:'+503', channel:'zinli' },
  { iso:'NI', name:'Nicaragua',        currency:'USD', dialCode:'+505', channel:'zinli' },
  { iso:'CU', name:'Cuba',             currency:'USD', dialCode:'+53',  channel:'zinli' },
  { iso:'PR', name:'Puerto Rico',      currency:'USD', dialCode:'+1',   channel:'zinli' },
  { iso:'ES', name:'España',           currency:'USD', dialCode:'+34',  channel:'zinli' },
  { iso:'IT', name:'Italia',           currency:'USD', dialCode:'+39',  channel:'zinli' },
  { iso:'FR', name:'Francia',          currency:'USD', dialCode:'+33',  channel:'zinli' },
  { iso:'DE', name:'Alemania',         currency:'USD', dialCode:'+49',  channel:'zinli' },
  { iso:'PT', name:'Portugal',         currency:'USD', dialCode:'+351', channel:'zinli' },
  { iso:'GB', name:'Reino Unido',      currency:'USD', dialCode:'+44',  channel:'zinli' },
  { iso:'CA', name:'Canadá',           currency:'USD', dialCode:'+1',   channel:'zinli' },
  { iso:'AU', name:'Australia',        currency:'USD', dialCode:'+61',  channel:'zinli' },
  { iso:'XX', name:'Otro país',        currency:'USD', dialCode:'',     channel:'zinli' },
];

const CHANNEL_LABEL = { pagomovil:'Pago Móvil', nequi:'Nequi', zinli:'Zinli' };
const GLOBE = String.fromCodePoint(0x1F310); // 🌐 (emoji plano, se ve en Windows)

function getCountry(iso) {
  return COUNTRIES.find(c => c.iso === iso) || COUNTRIES[COUNTRIES.length - 1];
}
function flagUrl(iso) {
  return (iso && iso !== 'XX') ? `https://flagcdn.com/w40/${iso.toLowerCase()}.png` : null;
}

// Pinta el botón trigger + chip de prefijo + placeholder de ejemplo + hidden value.
function renderTrigger(c) {
  const flag = document.getElementById('countryFlag');
  const globe = document.getElementById('countryGlobe');
  const name = document.getElementById('countryName');
  const prefix = document.getElementById('phonePrefix');
  const phone = document.getElementById('regPhone');
  const hidden = document.getElementById('regCountry');

  const url = flagUrl(c.iso);
  if (flag)  flag.style.display  = url ? 'block' : 'none';
  if (globe) globe.style.display = url ? 'none' : 'inline-block';
  if (url && flag) flag.src = url;
  if (globe) globe.textContent = GLOBE;
  if (name) name.textContent = c.name;
  if (prefix) prefix.textContent = c.dialCode || '';
  if (phone) phone.placeholder = c.example || 'Introduce tu número';
  if (hidden) hidden.value = c.iso;

  // Resalta la opción seleccionada en la lista
  document.querySelectorAll('.country-option').forEach(li => {
    li.classList.toggle('selected', li.dataset.iso === c.iso);
  });
}

function buildList() {
  const list = document.getElementById('countryList');
  if (!list) return;
  list.innerHTML = COUNTRIES.map(c => {
    const url = flagUrl(c.iso);
    const icon = url
      ? `<img class="country-flag" src="${url}" alt="">`
      : `<span class="country-globe">${GLOBE}</span>`;
    return `<li class="country-option" role="option" data-iso="${c.iso}">${icon}<span>${c.name}</span></li>`;
  }).join('');

  list.querySelectorAll('.country-option').forEach(li => {
    li.addEventListener('click', () => {
      renderTrigger(getCountry(li.dataset.iso));
      closeList();
    });
  });
}

function openList()  { const l = document.getElementById('countryList');  const t = document.getElementById('countryTrigger'); if (l) l.classList.add('open'); if (t) t.setAttribute('aria-expanded','true'); }
function closeList() { const l = document.getElementById('countryList');  const t = document.getElementById('countryTrigger'); if (l) l.classList.remove('open'); if (t) t.setAttribute('aria-expanded','false'); }
function toggleList(){ const l = document.getElementById('countryList'); if (l && l.classList.contains('open')) closeList(); else openList(); }

document.addEventListener('DOMContentLoaded', () => {
  const trigger = document.getElementById('countryTrigger');
  if (!trigger) return; // no estamos en el form de registro

  buildList();
  renderTrigger(getCountry('VE')); // Venezuela por defecto

  trigger.addEventListener('click', (e) => { e.stopPropagation(); toggleList(); });

  // Cerrar al hacer clic fuera
  document.addEventListener('click', (e) => {
    const sel = document.getElementById('countrySelect');
    if (sel && !sel.contains(e.target)) closeList();
  });
  // Cerrar con Escape
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeList(); });
});