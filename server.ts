import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// IPCA-E Table Globals
let ipcaeCache: any[] = [];
let ipcaeMetaData: { ultimaAtualizacao: string; totalRegistros: number } | null = null;

// Initialize GoogleGenAI client lazy-loaded
let aiClient: GoogleGenAI | null = null;

function getAiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("WARNING: GEMINI_API_KEY environment variable is not set. Calculating with local fallback simulation.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey || "MOCK_KEY",
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

async function atualizarTabelaIpcae(): Promise<{ sucesso: boolean; total: number; data: string; mensagem: string }> {
  try {
    const url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.10764/dados?formato=json&dataInicial=01/01/2001&dataFinal=";
    console.log("Iniciando requisição à API do Banco Central:", url);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Erro na requisição à API do Banco Central: ${response.status} ${response.statusText}`);
    }
    
    const dados = await response.json();
    if (!Array.isArray(dados) || dados.length === 0) {
      throw new Error("Formato de dados recebido da API do Banco Central é inválido.");
    }
    
    // Gravar de forma persistente no arquivo local
    const filePath = path.join(process.cwd(), "ipca_series.json");
    await fs.promises.writeFile(filePath, JSON.stringify(dados, null, 2), "utf-8");
    
    // Atualizar também o arquivo de metadados
    const metaPath = path.join(process.cwd(), "ipca_series_meta.json");
    const metaData = {
      ultimaAtualizacao: new Date().toISOString(),
      totalRegistros: dados.length
    };
    await fs.promises.writeFile(metaPath, JSON.stringify(metaData, null, 2), "utf-8");
    
    // Atualizar no cache em memória
    ipcaeCache = dados;
    ipcaeMetaData = metaData;
    
    console.log(`Tabela IPCA-E atualizada perfeitamente. Total de registros: ${dados.length}`);
    return {
      sucesso: true,
      total: dados.length,
      data: metaData.ultimaAtualizacao,
      mensagem: `Tabela atualizada com sucesso em ${new Date(metaData.ultimaAtualizacao).toLocaleString('pt-BR')}! Total de ${dados.length} registros importados.`
    };
  } catch (error: any) {
    console.error("Erro ao atualizar a tabela do IPCA-E no Banco Central:", error);
    return {
      sucesso: false,
      total: ipcaeCache ? ipcaeCache.length : 0,
      data: ipcaeMetaData ? ipcaeMetaData.ultimaAtualizacao : new Date().toISOString(),
      mensagem: `Erro ao buscar índices do Banco Central: ${error.message || error}`
    };
  }
}

function obterHistoricoDetalhadoDaTabela(anoObito: number, mesObito: number, registroIPCAE: any[]) {
  const steps: any[] = [];

  // Step 1: Base original (Janeiro 2001)
  steps.push({
    periodo: "Jan/2001",
    fatorPeriodo: "Base Real",
    valorOrtn: "R$ 6,5654",
    valorAcumulado500: "R$ 3.282,70",
    descricao: "Valor histórico de alçada de 500 ORTN consolidado na data do provimento do Tema 395 do Superior Tribunal de Justiça (STJ).",
    tipo: "STJ"
  });

  if (anoObito < 2001 || (anoObito === 2001 && mesObito <= 1)) {
    return steps;
  }

  let currentFactor = 1.0;
  let currentOrtnValue = 6.5654;

  // Iremos agrupar por ano e calcular o acumulado de cada ano correspondente
  for (let yr = 2001; yr <= anoObito; yr++) {
    let yearFactor = 1.0;
    let mesesProcessados = 0;
    
    // Filtramos os meses deste ano especificamente
    for (const item of registroIPCAE) {
      const parts = item.data.split("/");
      const m = parseInt(parts[1], 10);
      const a = parseInt(parts[2], 10);
      
      if (a === yr) {
        // Se for o ano do óbito, limitamos até o mês do óbito
        if (yr === anoObito && m > mesObito) {
          continue;
        }
        
        const val = parseFloat(item.valor.replace(",", "."));
        if (!isNaN(val)) {
          yearFactor *= (1 + (val / 100));
          mesesProcessados++;
        }
      }
    }
    
    // Se o ano atual teve meses processados (ou seja, houve variação real na tabela do Banco Central)
    if (mesesProcessados > 0) {
      currentFactor *= yearFactor;
      currentOrtnValue = 6.5654 * currentFactor;
      const accumulated500 = currentOrtnValue * 500;
      
      const variacaoPercentual = (yearFactor - 1) * 100;
      const ehAnoDoObito = (yr === anoObito);
      
      if (yr === 2001) {
        steps.push({
          periodo: ehAnoDoObito ? `Óbito (${String(mesObito).padStart(2, '0')}/2001)` : "Dez/2001",
          fatorPeriodo: `+${variacaoPercentual.toFixed(2)}%`,
          valorOrtn: `R$ ${currentOrtnValue.toFixed(4)}`,
          valorAcumulado500: `R$ ${accumulated500.toFixed(2)}`,
          descricao: ehAnoDoObito
            ? `Fechamento acumulado pós Tema 395 do STJ até o mês do óbito (${String(mesObito).padStart(2, '0')}/2001).`
            : "Reajuste acumulado do IPCA-E no exercício de 2001, a partir de Fevereiro.",
          tipo: ehAnoDoObito ? "obito" : "reajuste"
        });
      } else if (ehAnoDoObito) {
        steps.push({
          periodo: `${String(mesObito).padStart(2, '0')}/${anoObito}`,
          fatorPeriodo: `+${variacaoPercentual.toFixed(2)}%`,
          valorOrtn: `R$ ${currentOrtnValue.toFixed(4)}`,
          valorAcumulado500: `R$ ${accumulated500.toFixed(2)}`,
          descricao: `Mês do óbito. Atualização acumulada e proporcional pelo IPCA-E de Jan/${anoObito} até o mês de falecimento em ${String(mesObito).padStart(2, '0')}/${anoObito}.`,
          tipo: "obito"
        });
      } else {
        steps.push({
          periodo: `Dez/${yr}`,
          fatorPeriodo: `+${variacaoPercentual.toFixed(2)}%`,
          valorOrtn: `R$ ${currentOrtnValue.toFixed(4)}`,
          valorAcumulado500: `R$ ${accumulated500.toFixed(2)}`,
          descricao: `Exercício completo de ${yr}. Variação acumulada de ${variacaoPercentual.toFixed(2)}% do IPCA-E.`,
          tipo: "reajuste"
        });
      }
    } else {
      // Fallback usando a estimativa de inflação anual se por algum motivo o ano não estiver na tabela do BC
      const inflationRate = INFLACAO_ANUAL[yr] !== undefined ? INFLACAO_ANUAL[yr] : 0.04;
      let rateApplied = inflationRate;
      let isFinalYear = (yr === anoObito);
      
      if (isFinalYear) {
        const fraction = Math.min(1.0, mesObito / 12);
        rateApplied = inflationRate * fraction;
      }
      
      currentFactor *= (1 + rateApplied);
      currentOrtnValue = 6.5654 * currentFactor;
      const accumulated500 = currentOrtnValue * 500;
      
      steps.push({
        periodo: isFinalYear ? `${String(mesObito).padStart(2, '0')}/${anoObito}` : `Dez/${yr}`,
        fatorPeriodo: `+${(rateApplied * 100).toFixed(2)}%`,
        valorOrtn: `R$ ${currentOrtnValue.toFixed(4)}`,
        valorAcumulado500: `R$ ${accumulated500.toFixed(2)}`,
        descricao: isFinalYear 
          ? `Mês do óbito (estimativa de fechamento). Atualização pelo IPCA-E estimando ${(rateApplied * 100).toFixed(2)}%.`
          : `Exercício completo de ${yr} (estimativa). Variação anual de ${(inflationRate * 100).toFixed(2)}% do IPCA-E.`,
        tipo: isFinalYear ? "obito" : "reajuste"
      });
    }
  }

  return steps;
}

async function carregarOuDispararImportacaoInicial() {
  const filePath = path.join(process.cwd(), "ipca_series.json");
  const metaPath = path.join(process.cwd(), "ipca_series_meta.json");
  
  try {
    if (fs.existsSync(filePath)) {
      const rawData = await fs.promises.readFile(filePath, "utf-8");
      ipcaeCache = JSON.parse(rawData);
      console.log(`Dados históricos do IPCA-E carregados do arquivo local. Total: ${ipcaeCache.length} meses.`);
      
      if (fs.existsSync(metaPath)) {
        const rawMeta = await fs.promises.readFile(metaPath, "utf-8");
        ipcaeMetaData = JSON.parse(rawMeta);
        console.log(`Metadados de IPCA-E carregados. Última atualização: ${ipcaeMetaData.ultimaAtualizacao}`);
      }
    } else {
      console.log("Arquivo local 'ipca_series.json' não encontrado. Realizando importação inicial...");
      await atualizarTabelaIpcae();
    }
  } catch (err) {
    console.error("Erro ao carregar arquivos locais do IPCA-E, tentando inicializar direto da API:", err);
    await atualizarTabelaIpcae();
  }
}

function inicializarAgendador() {
  // Verifica a cada 6 horas se é necessário atualizar
  setInterval(async () => {
    try {
      const hoje = new Date();
      const dia = hoje.getDate();
      
      if (dia === 28) {
        // Verificar se já atualizou hoje ou este mês para não repetir desnecessariamente
        const hojeString = hoje.toISOString().split("T")[0]; // YYYY-MM-DD
        const ultimaDataString = ipcaeMetaData ? ipcaeMetaData.ultimaAtualizacao.split("T")[0] : "";
        
        // Se a última data de atualização não for hoje, atualiza!
        if (ultimaDataString !== hojeString) {
          console.log("Dia 28 detectado. Iniciando atualização agendada automática da tabela do IPCA-E...");
          await atualizarTabelaIpcae();
        }
      }
    } catch (e) {
      console.error("Erro no processamento do agendamento de atualização del IPCA-E:", e);
    }
  }, 1000 * 60 * 60 * 6); // Roda a cada 6 horas
}

// Enable JSON bodies parsing
app.use(express.json());

// Inflation data and deterministic ORTN reajuste helper
const INFLACAO_ANUAL: { [key: number]: number } = {
  2001: 0.0751,
  2002: 0.1193,
  2003: 0.1038,
  2004: 0.0659,
  2005: 0.0548,
  2006: 0.0314,
  2007: 0.0416,
  2008: 0.0610,
  2009: 0.0425,
  2010: 0.0561,
  2011: 0.0650,
  2012: 0.0578,
  2013: 0.0585,
  2014: 0.0646,
  2015: 0.1071,
  2016: 0.0629,
  2017: 0.0294,
  2018: 0.0386,
  2019: 0.0391,
  2020: 0.0423,
  2021: 0.1042,
  2022: 0.0590,
  2023: 0.0472,
  2024: 0.0431,
  2025: 0.0410,
  2026: 0.0380
};

function obterHistoricoDetalhado(dateStr: string) {
  const [yearStr, monthStr] = dateStr.split("-");
  const anoObito = parseInt(yearStr) || 2026;
  const mesObito = parseInt(monthStr) || 6;

  if (ipcaeCache && ipcaeCache.length > 0) {
    return obterHistoricoDetalhadoDaTabela(anoObito, mesObito, ipcaeCache);
  }

  const steps: any[] = [];

  // Step 1: Base original (Janeiro 2001)
  steps.push({
    periodo: "Jan/2001",
    fatorPeriodo: "Base Real",
    valorOrtn: "R$ 6,5654",
    valorAcumulado500: "R$ 3.282,70",
    descricao: "Valor histórico de alçada de 500 ORTN consolidado na data do provimento do Tema 395 do Superior Tribunal de Justiça (STJ).",
    tipo: "STJ"
  });

  if (anoObito >= 2001) {
    let currentFactor = 1.0;
    let currentOrtnValue = 6.5654;

    for (let yr = 2001; yr <= anoObito; yr++) {
      const inflationRate = INFLACAO_ANUAL[yr] !== undefined ? INFLACAO_ANUAL[yr] : 0.04;
      
      let rateApplied = inflationRate;
      let isFinalYear = (yr === anoObito);
      
      if (isFinalYear) {
        const fraction = Math.min(1.0, mesObito / 12);
        rateApplied = inflationRate * fraction;
      }
      
      currentFactor *= (1 + rateApplied);
      currentOrtnValue = 6.5654 * currentFactor;
      const accumulated500 = currentOrtnValue * 500;

      if (yr === 2001) {
        steps.push({
          periodo: isFinalYear ? `Óbito (${String(mesObito).padStart(2, '0')}/2001)` : "Dez/2001",
          fatorPeriodo: `+${(rateApplied * 100).toFixed(2)}%`,
          valorOrtn: `R$ ${currentOrtnValue.toFixed(4)}`,
          valorAcumulado500: `R$ ${accumulated500.toFixed(2)}`,
          descricao: isFinalYear 
            ? `Fechamento acumulado de 2001 até o mês do óbito (${String(mesObito).padStart(2, '0')}).`
            : "Reajuste anual pelo IPCA-E pós provimento do Tema 395 STJ (fator anual 7.51%).",
          tipo: isFinalYear ? "obito" : "reajuste"
        });
      } else if (yr === anoObito) {
        steps.push({
          periodo: `${String(mesObito).padStart(2, '0')}/${anoObito}`,
          fatorPeriodo: `+${(rateApplied * 100).toFixed(2)}%`,
          valorOrtn: `R$ ${currentOrtnValue.toFixed(4)}`,
          valorAcumulado500: `R$ ${accumulated500.toFixed(2)}`,
          descricao: `Mês do óbito. Atualização acumulada proporcional pelo IPCA-E até ${String(mesObito).padStart(2, '0')}/${anoObito}.`,
          tipo: "obito"
        });
      } else {
        steps.push({
          periodo: `Dez/${yr}`,
          fatorPeriodo: `+${(rateApplied * 100).toFixed(2)}%`,
          valorOrtn: `R$ ${currentOrtnValue.toFixed(4)}`,
          valorAcumulado500: `R$ ${accumulated500.toFixed(2)}`,
          descricao: `Variação anual de ${(inflationRate * 100).toFixed(2)}% do IPCA-E durante o exercício de ${yr}.`,
          tipo: "reajuste"
        });
      }
    }
  }

  return steps;
}

function calcularAtualizacaoDeterminista(dateStr: string, numericCauseValue: number) {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr) || 2026;
  const month = parseInt(monthStr) || 6;
  const day = parseInt(dayStr) || 1;

  const parsedDate = new Date(year, month - 1, day);
  const formattedDate = `${String(parsedDate.getDate()).padStart(2, '0')}/${String(parsedDate.getMonth() + 1).padStart(2, '0')}/${parsedDate.getFullYear()}`;

  let factor = 1.0;
  let usouTabelaReal = false;

  if (year > 2001 || (year === 2001 && month > 1)) {
    if (ipcaeCache && ipcaeCache.length > 0) {
      let accumulatedFactor = 1.0;
      let mesesCalculados = 0;
      
      const mesInicio = 1; // Janeiro/2001 (Base)
      const anoInicio = 2001;
      
      for (const item of ipcaeCache) {
        const parts = item.data.split("/");
        const m = parseInt(parts[1], 10);
        const a = parseInt(parts[2], 10);
        
        const epochAtual = a * 12 + m;
        const epochInicio = anoInicio * 12 + mesInicio;
        const epochObito = year * 12 + month;
        
        if (epochAtual >= epochInicio && epochAtual <= epochObito) {
          const val = parseFloat(item.valor.replace(",", "."));
          if (!isNaN(val)) {
            accumulatedFactor *= (1 + (val / 100));
            mesesCalculados++;
          }
        }
      }
      
      if (mesesCalculados > 0) {
        factor = accumulatedFactor;
        usouTabelaReal = true;
      }
    }

    if (!usouTabelaReal) {
      for (let yr = 2001; yr <= year; yr++) {
        const inflation = INFLACAO_ANUAL[yr] !== undefined ? INFLACAO_ANUAL[yr] : 0.04;
        if (yr === year) {
          const fraction = Math.min(1.0, month / 12);
          factor *= (1 + (inflation * fraction));
        } else {
          factor *= (1 + inflation);
        }
      }
    }
  } else {
    factor = 1.0;
  }

  const baseValueSTJ = 3282.70;
  const limiteAlcada = baseValueSTJ * factor;
  const otnUnitReais = limiteAlcada / 500;

  const isGreater = numericCauseValue > limiteAlcada;
  const comparacao = isGreater ? "MAIOR" : "MENOR";
  const message = isGreater
    ? `O valor informado de R$ ${numericCauseValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} supera o limite de alçada legal atualizado de R$ ${limiteAlcada.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (500 ORTNs) na data do óbito (${formattedDate}).`
    : `O valor informado de R$ ${numericCauseValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} está dentro do limite de alçada legal atualizado de R$ ${limiteAlcada.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (500 ORTNs) na data do óbito (${formattedDate}).`;

  const passosCalculo: string[] = [];
  const metodoUsadoMessage = usouTabelaReal
    ? `Correção Monetária por IPCA-E (Índices Mensais Oficiais do BC): de Jan/2001 até ${String(month).padStart(2, '0')}/${year}, calculada pela variação acumulada real de ${(factor).toFixed(5)}x.`
    : `Correção Monetária por IPCA-E (Estimativa): de Jan/2001 até o mês do óbito (${String(month).padStart(2, '0')}/${year}), acumula um fator de evolução de ${(factor).toFixed(5)}x.`;

  if (year >= 2001) {
    passosCalculo.push(`Parâmetro de Alçada STJ (Jan/2001): 500 ORTNs equivalem a R$ 3.282,70 (1 ORTN = R$ 6,5654).`);
    passosCalculo.push(metodoUsadoMessage);
    passosCalculo.push(`Cálculo do Limite: R$ 3.282,70 * ${(factor).toFixed(5)} = R$ ${limiteAlcada.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
    passosCalculo.push(`Cálculo Unitário da ORTN: R$ ${limiteAlcada.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} dividido por 500 = R$ ${otnUnitReais.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}.`);
    passosCalculo.push(`Comparação: R$ ${numericCauseValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} contra o teto legal de R$ ${limiteAlcada.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`);
  } else {
    passosCalculo.push(`Parâmetro de Alçada STJ (Jan/2001): 500 ORTNs equivalem a R$ 3.282,70.`);
    passosCalculo.push(`Data do óbito (${formattedDate}) anterior a Janeiro de 2001: Valor de alçada mantido no limite consolidado de R$ 3.282,70.`);
    passosCalculo.push(`Comparação: O valor pretendido de R$ ${numericCauseValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} contra o teto de R$ 3.282,70.`);
  }

  const historicoIndices = [
    { periodo: "Jan/2001", indice: `Tema 395 do STJ fixou 500 ORTNs em R$ 3.282,70 (1 ORTN = R$ 6,5654)` },
    { periodo: `${String(month).padStart(2, '0')}/${year}`, indice: `${usouTabelaReal ? 'IPCA-E real' : 'Fator IPCA-E estimado'} acumulado no período de ${(factor).toFixed(5)}x` }
  ];

  const detalhamentoHistorico = obterHistoricoDetalhado(dateStr);

  return {
    formattedDate,
    factor,
    limiteAlcada,
    otnUnitReais,
    comparacao,
    mensagemAlerta: message,
    passosCalculo,
    detalhamentoHistorico,
    historicoIndices
  };
}

// API: Calculation Endpoint
app.post("/api/calculate", async (req, res) => {
  try {
    const { date, causeValue } = req.body;

    if (!date) {
      return res.status(400).json({ status: "error", message: "A data de óbito é obrigatória." });
    }

    const numericCauseValue = Number(causeValue) || 0;

    // Execute o cálculo determinista ultra rápido sem recorrer ao Gemini
    const calc = calcularAtualizacaoDeterminista(date, numericCauseValue);

    return res.json({
      sucesso: true,
      dataObito: calc.formattedDate,
      valorCausa: numericCauseValue,
      fatorIPCAE: Number(calc.factor.toFixed(5)),
      ortnNominal: 6.5654,
      ortnUnitarioReais: Number(calc.otnUnitReais.toFixed(4)),
      limiteAlcadaReais: Number(calc.limiteAlcada.toFixed(2)),
      comparacao: calc.comparacao,
      mensagemAlerta: calc.mensagemAlerta,
      fundamentacaoLegal: "Cálculo analítico computado com alta precisão e segurança via base de índices locais: Em conformidade com o Artigo 2º da Lei 6.858/1980 e o Tema 395 do Superior Tribunal de Justiça (STJ), que adota como base histórica indexada para 500 ORTNs o valor de R$ 3.282,70 em janeiro de 2001, corrigido subsequentemente pelo IPCA-E até a data do falecimento do titular.",
      passosCalculo: calc.passosCalculo,
      historicoIndices: calc.historicoIndices,
      historicoDetalhamento: calc.detalhamentoHistorico
    });

  } catch (error: any) {
    console.log("Erro no processamento do cálculo local determinista:", error);
    res.status(500).json({
      sucesso: false,
      message: "Erro interno no cálculo."
    });
  }
});

app.post("/api/update-ipcae", async (req, res) => {
  console.log("Solicitação de atualização manual da tabela do IPCA-E recebida.");
  const resultado = await atualizarTabelaIpcae();
  
  if (resultado.sucesso) {
    return res.json({
      success: true,
      mensagem: resultado.mensagem,
      totalRegistros: resultado.total,
      ultimaAtualizacao: resultado.data
    });
  } else {
    return res.status(500).json({
      success: false,
      mensagem: resultado.mensagem,
      totalRegistros: resultado.total,
      ultimaAtualizacao: resultado.data
    });
  }
});

app.get("/api/ipcae-status", (req, res) => {
  return res.json({
    totalRegistros: ipcaeCache.length,
    ultimaAtualizacao: ipcaeMetaData ? ipcaeMetaData.ultimaAtualizacao : null
  });
});

// Serve frontend assets in production / run Vite in dev
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Inicializa o cache local/Banco Central e a rotina agendada periódica
  await carregarOuDispararImportacaoInicial();
  inicializarAgendador();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
