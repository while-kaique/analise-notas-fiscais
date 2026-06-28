// SPA da Conferência de NF por Cupom (v2) — vanilla JS, servida como asset estático.
// Fluxo (spec §9 / decisão 9): escolher perfil → mês + link do form → dashboard.
// Sem login Google na UI (decisão 11): o acesso já é gated pelo GoDeploy.

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

// ──────────────────────────── Carregar perfis ────────────────────────────

let perfisCarregados = [];

async function carregarPerfis() {
  const dados = await pedirJson("/api/perfis");
  perfisCarregados = dados.perfis || [];

  const sel = $("perfil");
  sel.innerHTML = "";
  for (const p of perfisCarregados) {
    const opt = document.createElement("option");
    opt.value = p.id;
    const frentes = (p.frentes || []).join(" · ");
    opt.textContent = `${p.marca.nome} — ${p.nome}${frentes ? ` (${frentes})` : ""}`;
    opt.disabled = !p.baseConfigurada;
    sel.appendChild(opt);
  }

  sel.addEventListener("change", aoTrocarPerfil);
  aoTrocarPerfil();
  mostrar("iniciar");
}

function perfilSelecionado() {
  return perfisCarregados.find((p) => p.id === $("perfil").value);
}

function aoTrocarPerfil() {
  const p = perfilSelecionado();
  const aviso = $("aviso-perfil");
  // Pré-preenche o link do form com o do mês anterior (decisão 4: salvo no perfil).
  if (p && p.formSheetUrl) $("form-url").value = p.formSheetUrl;
  if (p && !p.baseConfigurada) {
    aviso.textContent =
      "Este perfil ainda é um esqueleto (base não configurada). Escolha outro perfil.";
    aviso.classList.remove("oculto");
    $("btn-iniciar").disabled = true;
  } else {
    aviso.classList.add("oculto");
    $("btn-iniciar").disabled = false;
  }
}

// ──────────────────────────── Iniciar conferência ────────────────────────────

async function iniciarConferencia(evento) {
  evento.preventDefault();
  const btn = $("btn-iniciar");
  const erroEl = $("erro-form");
  erroEl.classList.add("oculto");
  btn.disabled = true;

  try {
    const corpo = {
      perfilId: $("perfil").value,
      mesAlvo: $("mes").value.trim(),
      formUrl: $("form-url").value.trim(),
    };
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

function pintarProgresso(p) {
  const rotuloJob = {
    CRIADO: "Preparando…",
    PROCESSANDO: "Processando…",
    AGUARDANDO_MAPEAMENTO: "Aguardando confirmação de colunas",
    CONCLUIDO: "Concluído",
    FALHOU: "Falhou",
  };
  const resumo = $("resumo-progresso");
  if (p.status === "CONCLUIDO") {
    resumo.textContent = `Concluído — ${p.total} cupom(ns) conferido(s).`;
  } else if (p.status === "FALHOU") {
    resumo.textContent = "A conferência falhou.";
  } else if (p.total === 0) {
    resumo.textContent = "Lendo a planilha e cruzando os cupons…";
  } else {
    resumo.textContent = `${rotuloJob[p.status] || p.status} — ${p.total} cupom(ns) até agora.`;
  }

  // Métricas por status (só as frentes de extração; SOMA vira "ajustes").
  const metricas = $("metricas");
  metricas.innerHTML = "";
  const adicionar = (rotulo, valor) => {
    const div = document.createElement("div");
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
    if (n) adicionar(ROTULO_STATUS[chave], n);
  }

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

// Classe de cor por status do cupom (espelha o vocabulário do backend).
const CLASSE_STATUS = {
  APROVADO: "ok",
  PARCIAL: "alerta",
  NAO_APROVADO: "ruim",
  CNPJ_DIFERENTE: "ruim",
  SEM_NF: "neutro",
  NAO_LEGIVEL: "ruim",
  SEM_BASE: "ruim",
};

let ultimaAtividadeId = 0; // cursor incremental (maior id já trazido)
let filaAtividades = []; // buffer revelado uma a uma (efeito "rolando")
let timerReveal = null;

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

function adicionarLinhaAtividade(ev) {
  const lista = $("atividades");
  if (!lista) return;
  $("atividades-vazio").classList.add("oculto");

  const li = document.createElement("li");
  li.className = "atividade entrando";
  if (ev.tipo === "cupom" || ev.tipo === "soma") {
    li.classList.add(`s-${CLASSE_STATUS[ev.status] || "neutro"}`);
  } else {
    li.classList.add("marco");
  }

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

// ──────────────────────────── Bootstrap ────────────────────────────

async function iniciar() {
  $("form-conf").addEventListener("submit", iniciarConferencia);
  $("form-mapa").addEventListener("submit", confirmarMapeamento);
  $("btn-nova").addEventListener("click", () => {
    pararPoll();
    reiniciarAtividades();
    jobAtual = null;
    $("mes").value = "";
    mostrar("iniciar");
  });

  try {
    await carregarPerfis();
  } catch (e) {
    $("estado-carregando").innerHTML = `<p class="erro">Falha ao carregar perfis: ${e.message}</p>`;
  }
}

iniciar();
