// public/js/countries.js
// Catálogo de países + autocompletado de prefijo telefónico.
// channel: cómo se cobra la suscripción en ese país.
// La MONEDA y el CANAL son fuente de verdad SERVER-SIDE al registrar (próximo paso);
// aquí el front solo los usa para MOSTRAR y para el prefijo del teléfono.

const COUNTRIES = [
  { iso:'VE', name:'Venezuela',        flag:'🇻🇪', currency:'VES', dialCode:'+58',  channel:'pagomovil' },
  { iso:'CO', name:'Colombia',         flag:'🇨🇴', currency:'COP', dialCode:'+57',  channel:'nequi'     },
  { iso:'US', name:'Estados Unidos',   flag:'🇺🇸', currency:'USD', dialCode:'+1',   channel:'zinli'     },
  { iso:'MX', name:'México',           flag:'🇲🇽', currency:'USD', dialCode:'+52',  channel:'zinli'     },
  { iso:'AR', name:'Argentina',        flag:'🇦🇷', currency:'USD', dialCode:'+54',  channel:'zinli'     },
  { iso:'CL', name:'Chile',            flag:'🇨🇱', currency:'USD', dialCode:'+56',  channel:'zinli'     },
  { iso:'PE', name:'Perú',             flag:'🇵🇪', currency:'USD', dialCode:'+51',  channel:'zinli'     },
  { iso:'EC', name:'Ecuador',          flag:'🇪🇨', currency:'USD', dialCode:'+593', channel:'zinli'     },
  { iso:'BO', name:'Bolivia',          flag:'🇧🇴', currency:'USD', dialCode:'+591', channel:'zinli'     },
  { iso:'PY', name:'Paraguay',         flag:'🇵🇾', currency:'USD', dialCode:'+595', channel:'zinli'     },
  { iso:'UY', name:'Uruguay',          flag:'🇺🇾', currency:'USD', dialCode:'+598', channel:'zinli'     },
  { iso:'BR', name:'Brasil',           flag:'🇧🇷', currency:'USD', dialCode:'+55',  channel:'zinli'     },
  { iso:'PA', name:'Panamá',           flag:'🇵🇦', currency:'USD', dialCode:'+507', channel:'zinli'     },
  { iso:'CR', name:'Costa Rica',       flag:'🇨🇷', currency:'USD', dialCode:'+506', channel:'zinli'     },
  { iso:'DO', name:'Rep. Dominicana',  flag:'🇩🇴', currency:'USD', dialCode:'+1',   channel:'zinli'     },
  { iso:'GT', name:'Guatemala',        flag:'🇬🇹', currency:'USD', dialCode:'+502', channel:'zinli'     },
  { iso:'HN', name:'Honduras',         flag:'🇭🇳', currency:'USD', dialCode:'+504', channel:'zinli'     },
  { iso:'SV', name:'El Salvador',      flag:'🇸🇻', currency:'USD', dialCode:'+503', channel:'zinli'     },
  { iso:'NI', name:'Nicaragua',        flag:'🇳🇮', currency:'USD', dialCode:'+505', channel:'zinli'     },
  { iso:'CU', name:'Cuba',             flag:'🇨🇺', currency:'USD', dialCode:'+53',  channel:'zinli'     },
  { iso:'PR', name:'Puerto Rico',      flag:'🇵🇷', currency:'USD', dialCode:'+1',   channel:'zinli'     },
  { iso:'ES', name:'España',           flag:'🇪🇸', currency:'USD', dialCode:'+34',  channel:'zinli'     },
  { iso:'IT', name:'Italia',           flag:'🇮🇹', currency:'USD', dialCode:'+39',  channel:'zinli'     },
  { iso:'FR', name:'Francia',          flag:'🇫🇷', currency:'USD', dialCode:'+33',  channel:'zinli'     },
  { iso:'DE', name:'Alemania',         flag:'🇩🇪', currency:'USD', dialCode:'+49',  channel:'zinli'     },
  { iso:'PT', name:'Portugal',         flag:'🇵🇹', currency:'USD', dialCode:'+351', channel:'zinli'     },
  { iso:'GB', name:'Reino Unido',      flag:'🇬🇧', currency:'USD', dialCode:'+44',  channel:'zinli'     },
  { iso:'CA', name:'Canadá',           flag:'🇨🇦', currency:'USD', dialCode:'+1',   channel:'zinli'     },
  { iso:'AU', name:'Australia',        flag:'🇦🇺', currency:'USD', dialCode:'+61',  channel:'zinli'     },
  { iso:'XX', name:'Otro país',        flag:'🌐', currency:'USD', dialCode:'',     channel:'zinli'     },
];

const CHANNEL_LABEL = { pagomovil:'Pago Móvil', nequi:'Nequi', zinli:'Zinli' };

function getCountry(iso) {
  return COUNTRIES.find(c => c.iso === iso) || COUNTRIES[COUNTRIES.length - 1];
}

// Rellena un <select> con el catálogo (bandera + nombre).
function populateCountrySelect(selectEl, selectedIso) {
  if (!selectEl) return;
  selectEl.innerHTML = COUNTRIES.map(c =>
    `<option value="${c.iso}" ${c.iso === selectedIso ? 'selected' : ''}>${c.flag}  ${c.name}</option>`
  ).join('');
}

// Al cambiar de país: autocompleta el prefijo en el teléfono (sin duplicar '+')
// y actualiza la pista informativa de moneda/canal.
function bindCountryPhone(selectEl, phoneEl, hintEl) {
  if (!selectEl) return;
  const apply = () => {
    const c = getCountry(selectEl.value);
    if (phoneEl) {
      const v = phoneEl.value.trim();
      if (!v) phoneEl.value = c.dialCode ? c.dialCode + ' ' : '';
      else if (c.dialCode && !v.startsWith('+')) phoneEl.value = c.dialCode + ' ' + v;
      // si ya empieza por '+', lo respetamos (el usuario lo escribió a mano)
    }
    if (hintEl) hintEl.textContent = `Moneda: ${c.currency} · Cobro: ${CHANNEL_LABEL[c.channel] || c.channel}`;
  };
  selectEl.addEventListener('change', apply);
  apply(); // estado inicial
}

// Auto-inicialización: busca el form de registro y conecta todo.
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('regCountry');
  if (!sel) return;
  populateCountrySelect(sel, 'VE'); // Venezuela por defecto (tu mercado principal)
  bindCountryPhone(sel, document.getElementById('regPhone'), document.getElementById('regCurrencyHint'));
});