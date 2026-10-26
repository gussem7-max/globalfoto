// public/js/countries.js
// Catálogo de países + autocompletado de prefijo telefónico.
// La bandera se DERIVA del ISO (sin emojis literales => no se trunca al pegar).
// channel: cómo se cobra la suscripción en ese país.

const COUNTRIES = [
  { iso:'VE', name:'Venezuela',        currency:'VES', dialCode:'+58',  channel:'pagomovil' },
  { iso:'CO', name:'Colombia',         currency:'COP', dialCode:'+57',  channel:'nequi'     },
  { iso:'US', name:'Estados Unidos',   currency:'USD', dialCode:'+1',   channel:'zinli'     },
  { iso:'MX', name:'México',           currency:'USD', dialCode:'+52',  channel:'zinli'     },
  { iso:'AR', name:'Argentina',        currency:'USD', dialCode:'+54',  channel:'zinli'     },
  { iso:'CL', name:'Chile',            currency:'USD', dialCode:'+56',  channel:'zinli'     },
  { iso:'PE', name:'Perú',             currency:'USD', dialCode:'+51',  channel:'zinli'     },
  { iso:'EC', name:'Ecuador',          currency:'USD', dialCode:'+593', channel:'zinli'     },
  { iso:'BO', name:'Bolivia',          currency:'USD', dialCode:'+591', channel:'zinli'     },
  { iso:'PY', name:'Paraguay',         currency:'USD', dialCode:'+595', channel:'zinli'     },
  { iso:'UY', name:'Uruguay',          currency:'USD', dialCode:'+598', channel:'zinli'     },
  { iso:'BR', name:'Brasil',           currency:'USD', dialCode:'+55',  channel:'zinli'     },
  { iso:'PA', name:'Panamá',           currency:'USD', dialCode:'+507', channel:'zinli'     },
  { iso:'CR', name:'Costa Rica',       currency:'USD', dialCode:'+506', channel:'zinli'     },
  { iso:'DO', name:'Rep. Dominicana',  currency:'USD', dialCode:'+1',   channel:'zinli'     },
  { iso:'GT', name:'Guatemala',        currency:'USD', dialCode:'+502', channel:'zinli'     },
  { iso:'HN', name:'Honduras',         currency:'USD', dialCode:'+504', channel:'zinli'     },
  { iso:'SV', name:'El Salvador',      currency:'USD', dialCode:'+503', channel:'zinli'     },
  { iso:'NI', name:'Nicaragua',        currency:'USD', dialCode:'+505', channel:'zinli'     },
  { iso:'CU', name:'Cuba',             currency:'USD', dialCode:'+53',  channel:'zinli'     },
  { iso:'PR', name:'Puerto Rico',      currency:'USD', dialCode:'+1',   channel:'zinli'     },
  { iso:'ES', name:'España',           currency:'USD', dialCode:'+34',  channel:'zinli'     },
  { iso:'IT', name:'Italia',           currency:'USD', dialCode:'+39',  channel:'zinli'     },
  { iso:'FR', name:'Francia',          currency:'USD', dialCode:'+33',  channel:'zinli'     },
  { iso:'DE', name:'Alemania',         currency:'USD', dialCode:'+49',  channel:'zinli'     },
  { iso:'PT', name:'Portugal',         currency:'USD', dialCode:'+351', channel:'zinli'     },
  { iso:'GB', name:'Reino Unido',      currency:'USD', dialCode:'+44',  channel:'zinli'     },
  { iso:'CA', name:'Canadá',           currency:'USD', dialCode:'+1',   channel:'zinli'     },
  { iso:'AU', name:'Australia',        currency:'USD', dialCode:'+61',  channel:'zinli'     },
  { iso:'XX', name:'Otro país',        currency:'USD', dialCode:'',     channel:'zinli'     },
];

const CHANNEL_LABEL = { pagomovil:'Pago Móvil', nequi:'Nequi', zinli:'Zinli' };
const GLOBE = String.fromCodePoint(0x1F310);

function flagEmoji(iso) {
  if (!iso || iso.length !== 2 || iso === 'XX') return GLOBE;
  const base = 0x1F1E6; // Regional Indicator "A"
  const cp = [...iso.toUpperCase()].map(ch => base + (ch.charCodeAt(0) - 65));
  return String.fromCodePoint(...cp);
}

function getCountry(iso) {
  return COUNTRIES.find(c => c.iso === iso) || COUNTRIES[COUNTRIES.length - 1];
}

function populateCountrySelect(selectEl, selectedIso) {
  if (!selectEl) return;
  selectEl.innerHTML = COUNTRIES.map(c =>
    `<option value="${c.iso}" ${c.iso === selectedIso ? 'selected' : ''}>${flagEmoji(c.iso)}  ${c.name}</option>`
  ).join('');
}

// Al cambiar de país: actualiza el prefijo del teléfono SIN borrar lo que el
// usuario ya tipeó. Regla: el sistema recuerda el prefijo que ÉL puso (lastDial)
// y solo reemplaza ese; un '+' escrito a mano desde cero se respeta.
function bindCountryPhone(selectEl, phoneEl) {
  if (!selectEl) return;
  let lastDial = '';

  const apply = () => {
    const c = getCountry(selectEl.value);
    const newDial = c.dialCode || '';
    if (phoneEl) {
      let v = phoneEl.value;
      if (v.trim() === '') {
        v = newDial ? newDial + ' ' : '';
      } else if (lastDial && v.startsWith(lastDial)) {
        const rest = v.slice(lastDial.length).replace(/^\s+/, '');
        v = newDial ? (newDial + (rest ? ' ' + rest : '')) : rest;
      } else if (!v.startsWith('+')) {
        v = newDial ? newDial + ' ' + v : v;
      }
      // else: empieza con '+' y no coincide con nuestro prefijo => escrito a mano, respetar
      phoneEl.value = v;
    }
    lastDial = newDial;
  };

  selectEl.addEventListener('change', apply);
  apply();
}

document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('regCountry');
  if (!sel) return;
  populateCountrySelect(sel, 'VE');
  bindCountryPhone(sel, document.getElementById('regPhone'));
});