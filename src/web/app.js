// SPA da Conferência de NF por Cupom (v2) — vanilla JS, servida como asset estático.
// Fluxo (spec §9 / decisão 9): escolher marca/perfil → mês + link do form → dashboard.
// Sem login Google na UI (decisão 11): o acesso já é gated pelo GoDeploy.
// Identidade visual GoGroup (identidade_visual_gogroup.md): azul + lime, Poppins, selo "g".

const $ = (id) => document.getElementById(id);

const secoes = {
  carregando: $("estado-carregando"),
  iniciar: $("estado-iniciar"),
  mapeamento: $("estado-mapeamento"),
  progresso: $("estado-progresso"),
};

function mostrar(nome) {
  for (const [chave, el] of Object.entries(secoes)) {
    if (el) el.classList.toggle("oculto", chave !== nome);
  }
}

// Espelha ROTULO_STATUS (src/conferencia/tipos.ts) — a chave da API é o enum.
const ROTULO_STATUS = {
  APROVADO: "Aprovado",
  PARCIAL: "Parcial",
  NAO_APROVADO: "Não Aprovado",
  SEM_NF: "Sem NF anexada",
  NAO_LEGIVEL: "Não foi possível ler a NF",
  CNPJ_DIFERENTE: "CNPJ diferente",
  SEM_BASE: "Cupom não encontrado na base",
};
// Ordem fixa de exibição (do melhor ao pior, depois os especiais).
const ORDEM_STATUS = [
  "APROVADO",
  "PARCIAL",
  "NAO_APROVADO",
  "CNPJ_DIFERENTE",
  "SEM_NF",
  "NAO_LEGIVEL",
  "SEM_BASE",
];
// Classe de cor por status (ok/alerta/ruim/neutro) — espelha o vocabulário visual do CSS.
const CLASSE_STATUS = {
  APROVADO: "ok",
  PARCIAL: "alerta",
  NAO_APROVADO: "ruim",
  CNPJ_DIFERENTE: "ruim",
  SEM_NF: "neutro",
  NAO_LEGIVEL: "ruim",
  SEM_BASE: "ruim",
};

async function pedirJson(url, opcoes) {
  const resp = await fetch(url, { credentials: "same-origin", ...opcoes });
  let dados = null;
  try {
    dados = await resp.json();
  } catch {
    /* sem corpo JSON */
  }
  if (!resp.ok) {
    const msg = (dados && dados.erro) || `Erro ${resp.status}`;
    throw new Error(msg);
  }
  return dados;
}

let intervaloPoll = null;
let jobAtual = null;
let urlFormAtual = ""; // link do form da conferência em curso (p/ "Abrir formulário")

// ──────────────────────────── Carregar perfis (cards de marca) ────────────────────────────

let perfisCarregados = [];
let perfilSelecionadoId = null;

async function carregarPerfis() {
  const dados = await pedirJson("/api/perfis");
  perfisCarregados = dados.perfis || [];
  renderizarPerfis();
  mostrar("iniciar");
}

function renderizarPerfis() {
  const lista = $("perfis-lista");
  lista.innerHTML = "";
  perfilSelecionadoId = null;

  for (const p of perfisCarregados) {
    const disponivel = !!p.baseConfigurada;
    const card = document.createElement("label");
    card.className = "perfil-card" + (disponivel ? "" : " desabilitado");

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "perfil";
    radio.value = p.id;
    radio.disabled = !disponivel;
    radio.addEventListener("change", () => selecionarPerfil(p.id));
    card.appendChild(radio);

    const marca = document.createElement("span");
    marca.className = "marca-nome";
    marca.textContent = p.marca.nome;
    card.appendChild(marca);

    const nome = document.createElement("p");
    nome.className = "perfil-nome";
    nome.textContent = p.nome;
    card.appendChild(nome);

    const frentes = document.createElement("div");
    frentes.className = "perfil-frentes";
    for (const f of p.frentes || []) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = f;
      frentes.appendChild(tag);
    }
    card.appendChild(frentes);

    if (!disponivel) {
      const selo = document.createElement("span");
      selo.className = "selo-esqueleto";
      selo.textContent = "Em breve";
      card.appendChild(selo);
    }
    lista.appendChild(card);
  }

  // Pré-seleciona o primeiro perfil disponível.
  const primeiro = perfisCarregados.find((p) => p.baseConfigurada);
  if (primeiro) {
    const radio = lista.querySelector(`input[value="${cssEscape(primeiro.id)}"]`);
    if (radio) {
      radio.checked = true;
      selecionarPerfil(primeiro.id);
    }
  } else {
    avisarSemPerfil();
  }
}

function cssEscape(v) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v;
}

function perfilPorId(id) {
  return perfisCarregados.find((p) => p.id === id);
}

function selecionarPerfil(id) {
  perfilSelecionadoId = id;
  const p = perfilPorId(id);

  // Realce visual do card escolhido.
  for (const card of $("perfis-lista").querySelectorAll(".perfil-card")) {
    const radio = card.querySelector("input");
    card.classList.toggle("selecionado", !!radio && radio.checked);
  }

  // Pré-preenche o link do form com o do mês anterior (decisão 4: salvo no perfil).
  if (p && p.formSheetUrl) $("form-url").value = p.formSheetUrl;

  const aviso = $("aviso-perfil");
  aviso.classList.add("oculto");
  $("btn-iniciar").disabled = false;
}

function avisarSemPerfil() {
  const aviso = $("aviso-perfil");
  aviso.textContent =
    "Nenhuma marca está configurada ainda. As marcas em preparo aparecem como “Em breve”.";
  aviso.classList.remove("oculto");
  $("btn-iniciar").disabled = true;
}

// ──────────────────────────── Iniciar conferência ────────────────────────────

async function iniciarConferencia(evento) {
  evento.preventDefault();
  const btn = $("btn-iniciar");
  const erroEl = $("erro-form");
  erroEl.classList.add("oculto");

  if (!perfilSelecionadoId) {
    erroEl.textContent = "Escolha uma marca para começar.";
    erroEl.classList.remove("oculto");
    return;
  }

  btn.disabled = true;
  try {
    const corpo = {
      perfilId: perfilSelecionadoId,
      mesAlvo: $("mes").value.trim(),
      formUrl: $("form-url").value.trim(),
    };
    urlFormAtual = corpo.formUrl;
    const res = await pedirJson("/api/conferencias", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
    acompanhar(res.jobId);
  } catch (e) {
    erroEl.textContent = e.message;
    erroEl.classList.remove("oculto");
  } finally {
    btn.disabled = false;
  }
}

// ──────────────────────────── Dashboard / progresso ────────────────────────────

function pararPoll() {
  if (intervaloPoll) clearInterval(intervaloPoll);
  intervaloPoll = null;
}

const ROTULO_JOB = {
  CRIADO: "Preparando…",
  PROCESSANDO: "Processando…",
  AGUARDANDO_MAPEAMENTO: "Aguardando colunas",
  CONCLUIDO: "Concluído",
  FALHOU: "Falhou",
};

function pintarProgresso(p) {
  // Selo "g" como batimento vivo do job.
  const selo = $("selo-vivo");
  selo.classList.remove("processando", "concluido", "falhou");
  if (p.status === "CONCLUIDO") selo.classList.add("concluido");
  else if (p.status === "FALHOU") selo.classList.add("falhou");
  else selo.classList.add("processando");

  // Pill de status + resumo em texto.
  const pill = $("status-pill");
  pill.textContent = ROTULO_JOB[p.status] || p.status;
  pill.className = "badge " + (p.status === "CONCLUIDO" ? "badge-lime" : "badge-blue");

  const marca = perfilPorId(p.perfilId);
  const nomeMarca = marca ? marca.marca.nome : "";
  const resumo = $("resumo-progresso");
  if (p.status === "CONCLUIDO") {
    resumo.textContent = `${nomeMarca ? nomeMarca + " · " : ""}${p.mesAlvo} — ${p.total} cupom(ns) conferido(s).`;
  } else if (p.status === "FALHOU") {
    resumo.textContent = "A conferência falhou. Veja o detalhe abaixo.";
  } else if (p.total === 0) {
    resumo.textContent = "Lendo a planilha e cruzando os cupons…";
  } else {
    resumo.textContent = `${nomeMarca ? nomeMarca + " · " : ""}${p.mesAlvo} — ${p.total} cupom(ns) até agora.`;
  }

  // Link "Abrir formulário".
  const abrir = $("abrir-form");
  if (urlFormAtual) {
    abrir.href = urlFormAtual;
    abrir.classList.remove("oculto");
  } else {
    abrir.classList.add("oculto");
  }

  pintarHeroi(p);
  pintarMetricas(p);

  const ajustes = $("info-ajustes");
  if (p.ajustesSoma > 0) {
    ajustes.textContent = `${p.ajustesSoma} cupom(ns) reconciliado(s) pela soma (influ + assessoria).`;
    ajustes.classList.remove("oculto");
  } else {
    ajustes.classList.add("oculto");
  }

  const erroEl = $("erro-job");
  if (p.erro) {
    erroEl.textContent = p.erro;
    erroEl.classList.remove("oculto");
  } else {
    erroEl.classList.add("oculto");
  }
}

// Taxa de aprovação (APROVADO / total) + barra de distribuição empilhada.
function pintarHeroi(p) {
  const herois = $("herois");
  const total = p.total ?? 0;
  if (total === 0) {
    herois.classList.add("oculto");
    return;
  }
  herois.classList.remove("oculto");

  const aprovados = (p.porStatus || {}).APROVADO || 0;
  const taxa = Math.round((aprovados / total) * 100);
  $("taxa-num").textContent = `${taxa}%`;

  // Segmentos da barra + legenda, na ordem fixa de status.
  const barra = $("barra-dist");
  const legenda = $("barra-legenda");
  barra.innerHTML = "";
  legenda.innerHTML = "";
  for (const chave of ORDEM_STATUS) {
    const n = (p.porStatus || {})[chave];
    if (!n) continue;
    const classe = CLASSE_STATUS[chave] || "neutro";

    const seg = document.createElement("span");
    seg.className = `seg ${classe}`;
    seg.style.flexGrow = String(n);
    seg.title = `${ROTULO_STATUS[chave]}: ${n}`;
    barra.appendChild(seg);

    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = `dot ${classe}`;
    li.appendChild(dot);
    li.appendChild(document.createTextNode(`${ROTULO_STATUS[chave]} · ${n}`));
    legenda.appendChild(li);
  }
}

function pintarMetricas(p) {
  const metricas = $("metricas");
  metricas.innerHTML = "";
  const adicionar = (rotulo, valor, classe) => {
    const div = document.createElement("div");
    div.className = "metrica" + (classe ? ` ${classe}` : "");
    const dt = document.createElement("dt");
    dt.textContent = rotulo;
    const dd = document.createElement("dd");
    dd.textContent = valor;
    div.append(dt, dd);
    metricas.appendChild(div);
  };
  adicionar("Total", p.total ?? 0);
  for (const chave of ORDEM_STATUS) {
    const n = (p.porStatus || {})[chave];
    if (n) adicionar(ROTULO_STATUS[chave], n, CLASSE_STATUS[chave]);
  }
}

function acompanhar(jobId) {
  // Mesmo job (ex.: religado após confirmar mapeamento) → mantém o feed e o cursor.
  const mesmoJob = jobAtual === jobId;
  jobAtual = jobId;
  mostrar("progresso");
  pararPoll();
  if (!mesmoJob) reiniciarAtividades();

  const tick = async () => {
    try {
      const p = await pedirJson(`/api/conferencias/${jobId}`);
      buscarAtividades(jobId); // feed roda independente do status (não bloqueia o poll)
      if (p.status === "AGUARDANDO_MAPEAMENTO" && p.pendenciaMapa) {
        pararPoll();
        mostrarMapeamento(jobId, p.pendenciaMapa);
        return;
      }
      pintarProgresso(p);
      if (p.status === "CONCLUIDO" || p.status === "FALHOU") {
        pararPoll();
      }
    } catch (e) {
      // erro transitório de rede não derruba a tela; o poll segue
      console.warn("poll:", e.message);
    }
  };

  tick();
  intervaloPoll = setInterval(tick, 2500);
}

// ──────────────────────────── Feed de atividades (tempo real) ────────────────────────────

let ultimaAtividadeId = 0; // cursor incremental (maior id já trazido)
let filaAtividades = []; // buffer revelado uma a uma (efeito "rolando")
let timerReveal = null;
let filtroFeed = "tudo"; // tudo | ok | alerta | ruim

function reiniciarAtividades() {
  if (timerReveal) clearInterval(timerReveal);
  timerReveal = null;
  filaAtividades = [];
  ultimaAtividadeId = 0;
  const lista = $("atividades");
  if (lista) lista.innerHTML = "";
  $("atividades-vazio").classList.remove("oculto");
  $("pulso-atividades").classList.add("oculto");
}

async function buscarAtividades(jobId) {
  let dados;
  try {
    dados = await pedirJson(
      `/api/conferencias/${jobId}/atividades?desde=${ultimaAtividadeId}`,
    );
  } catch (e) {
    console.warn("atividades:", e.message);
    return;
  }
  const novas = dados.atividades || [];
  if (novas.length === 0) return;
  ultimaAtividadeId = dados.ultimoId || ultimaAtividadeId;
  filaAtividades.push(...novas);
  iniciarReveal();
}

function iniciarReveal() {
  if (timerReveal) return; // já está revelando
  $("pulso-atividades").classList.remove("oculto");

  const passo = () => {
    // Se acumulou muito, revela em blocos para não deixar a fila "atrasada".
    const lote = filaAtividades.length > 40 ? 4 : 1;
    for (let i = 0; i < lote; i++) {
      const ev = filaAtividades.shift();
      if (!ev) break;
      adicionarLinhaAtividade(ev);
    }
    if (filaAtividades.length === 0) {
      clearInterval(timerReveal);
      timerReveal = null;
      $("pulso-atividades").classList.add("oculto");
    }
  };

  passo();
  timerReveal = setInterval(passo, 130);
}

function classeDaAtividade(ev) {
  if (ev.tipo === "cupom" || ev.tipo === "soma") {
    return CLASSE_STATUS[ev.status] || "neutro";
  }
  return null; // marco do job
}

function adicionarLinhaAtividade(ev) {
  const lista = $("atividades");
  if (!lista) return;
  $("atividades-vazio").classList.add("oculto");

  const classe = classeDaAtividade(ev);
  const li = document.createElement("li");
  li.className = "atividade entrando";
  if (classe) {
    li.classList.add(`s-${classe}`);
    li.dataset.classe = classe;
  } else {
    li.classList.add("marco");
    li.dataset.classe = "marco";
  }
  if (!atividadeVisivelNoFiltro(li)) li.classList.add("escondida");

  const ponto = document.createElement("span");
  ponto.className = "ponto";
  const texto = document.createElement("span");
  texto.className = "texto";
  texto.textContent = ev.mensagem;
  li.append(ponto, texto);

  lista.prepend(li); // a mais nova no topo; as antigas descem
  requestAnimationFrame(() => li.classList.remove("entrando"));

  // Mantém só as últimas linhas na tela (DOM enxuto).
  while (lista.children.length > 150) lista.removeChild(lista.lastChild);
}

function atividadeVisivelNoFiltro(li) {
  if (filtroFeed === "tudo") return true;
  return li.dataset.classe === filtroFeed;
}

function aplicarFiltroFeed(filtro) {
  filtroFeed = filtro;
  for (const chip of $("filtros-feed").querySelectorAll(".chip")) {
    const ativo = chip.dataset.filtro === filtro;
    chip.classList.toggle("ativo", ativo);
    chip.setAttribute("aria-selected", ativo ? "true" : "false");
  }
  for (const li of $("atividades").children) {
    li.classList.toggle("escondida", !atividadeVisivelNoFiltro(li));
  }
}

// ──────────────────────────── Confirmação de mapeamento ────────────────────────────

let frentePendente = null;

function mostrarMapeamento(jobId, pendencia) {
  frentePendente = pendencia.frente;
  const campos = $("campos-mapa");
  campos.innerHTML = "";

  const cabecalhos = pendencia.cabecalhos || [];
  for (const papel of pendencia.papeis || []) {
    const id = `mapa-${papel}`;
    const label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = papel;
    const sel = document.createElement("select");
    sel.id = id;
    sel.dataset.papel = papel;

    const vazio = document.createElement("option");
    vazio.value = "";
    vazio.textContent = "— escolher coluna —";
    sel.appendChild(vazio);

    const proposto = (pendencia.proposto || {})[papel];
    for (const col of cabecalhos) {
      const opt = document.createElement("option");
      opt.value = col;
      opt.textContent = col;
      if (proposto && proposto.coluna === col) opt.selected = true;
      sel.appendChild(opt);
    }
    campos.append(label, sel);
  }

  mostrar("mapeamento");
}

async function confirmarMapeamento(evento) {
  evento.preventDefault();
  const btn = $("btn-mapa");
  const erroEl = $("erro-mapa");
  erroEl.classList.add("oculto");
  btn.disabled = true;

  try {
    const mapeamento = {};
    for (const sel of $("campos-mapa").querySelectorAll("select")) {
      const col = sel.value.trim();
      if (col) mapeamento[sel.dataset.papel] = col;
    }
    if (Object.keys(mapeamento).length === 0) {
      throw new Error("Escolha ao menos uma coluna.");
    }
    await pedirJson(`/api/conferencias/${jobAtual}/mapeamento`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ frente: frentePendente, mapeamento }),
    });
    acompanhar(jobAtual); // religa o polling; o job volta a PROCESSANDO
  } catch (e) {
    erroEl.textContent = e.message;
    erroEl.classList.remove("oculto");
  } finally {
    btn.disabled = false;
  }
}

// ──────────────────────────── Máscara do campo de mês ────────────────────────────

function mascararMes(e) {
  const input = e.target;
  let v = input.value.replace(/\D/g, "").slice(0, 6);
  if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`;
  input.value = v;
}

// ──────────────────────────── Bootstrap ────────────────────────────

async function iniciar() {
  $("form-conf").addEventListener("submit", iniciarConferencia);
  $("form-mapa").addEventListener("submit", confirmarMapeamento);
  $("mes").addEventListener("input", mascararMes);
  $("filtros-feed").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) aplicarFiltroFeed(chip.dataset.filtro);
  });
  $("btn-nova").addEventListener("click", () => {
    pararPoll();
    reiniciarAtividades();
    jobAtual = null;
    urlFormAtual = "";
    filtroFeed = "tudo";
    $("mes").value = "";
    mostrar("iniciar");
  });

  try {
    await carregarPerfis();
  } catch (e) {
    $("estado-carregando").innerHTML =
      `<p class="erro">Não foi possível carregar as marcas: ${e.message}. Recarregue a página.</p>`;
  }
}

iniciar();
