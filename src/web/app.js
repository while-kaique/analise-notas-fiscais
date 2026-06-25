// SPA da Análise de Notas Fiscais — vanilla JS, servida como asset estático.
// A devolutiva na tela (CLAUDE.md §Decisões): login → colar link → progresso + resumo.

const $ = (id) => document.getElementById(id);

const secoes = {
  carregando: $("estado-carregando"),
  login: $("estado-login"),
  app: $("estado-app"),
  progresso: $("estado-progresso"),
};

function mostrar(nome) {
  for (const [chave, el] of Object.entries(secoes)) {
    el.classList.toggle("oculto", chave !== nome);
  }
}

function formatarReais(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

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

function pintarProgresso(p) {
  const feito = p.concluidos + p.erros;
  const pct = p.total > 0 ? Math.round((feito / p.total) * 100) : 0;
  $("barra-preenchida").style.width = pct + "%";
  $("m-total").textContent = p.total;
  $("m-concluidos").textContent = p.concluidos;
  $("m-processando").textContent = p.processando;
  $("m-pendentes").textContent = p.pendentes;
  $("m-erros").textContent = p.erros;
  $("m-valor").textContent = formatarReais(p.valorTotalCentavos);

  const terminou = p.status === "CONCLUIDO" || p.status === "FALHOU";
  if (terminou && p.total > 0) {
    $("resumo-progresso").textContent =
      `Concluído: ${p.concluidos} de ${p.total} linha(s) processada(s), ${p.erros} com erro.`;
  } else if (p.total === 0) {
    $("resumo-progresso").textContent = "Lendo a planilha e preparando as linhas…";
  } else {
    $("resumo-progresso").textContent = `${pct}% — processando ${p.total} linha(s)…`;
  }
}

function acompanhar(jobId) {
  mostrar("progresso");
  if (intervaloPoll) clearInterval(intervaloPoll);

  const tick = async () => {
    try {
      const p = await pedirJson(`/api/jobs/${jobId}`);
      pintarProgresso(p);
      if (p.status === "CONCLUIDO" || p.status === "FALHOU") {
        clearInterval(intervaloPoll);
        intervaloPoll = null;
      }
    } catch (e) {
      // mantém o polling; erro transitório de rede não derruba a tela
      console.warn("poll:", e.message);
    }
  };

  tick();
  intervaloPoll = setInterval(tick, 2000);
  // Cutuca o processamento (sem esperar só pelo cron).
  pedirJson("/api/processar", { method: "POST" }).catch(() => {});
}

async function criarJob(evento) {
  evento.preventDefault();
  const btn = $("btn-criar");
  const erroEl = $("erro-form");
  erroEl.classList.add("oculto");
  btn.disabled = true;

  try {
    const url = $("url").value.trim();
    const aba = $("aba").value.trim();
    const corpo = { url };
    if (aba) corpo.aba = aba;
    const res = await pedirJson("/api/jobs", {
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

async function iniciar() {
  $("form-job").addEventListener("submit", criarJob);
  $("btn-novo").addEventListener("click", () => {
    if (intervaloPoll) clearInterval(intervaloPoll);
    $("url").value = "";
    $("aba").value = "";
    mostrar("app");
  });

  try {
    const eu = await pedirJson("/api/me");
    $("email-usuario").textContent = eu.email || "sua conta Google";
    mostrar("app");
  } catch {
    mostrar("login");
  }
}

iniciar();
