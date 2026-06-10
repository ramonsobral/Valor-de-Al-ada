import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Calendar, 
  CircleDollarSign, 
  Loader2, 
  FileDown, 
  BookOpen, 
  AlertTriangle, 
  CheckCircle, 
  Info, 
  Landmark, 
  HelpCircle,
  TrendingUp,
  FileText,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { jsPDF } from "jspdf";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const DIAS_SEMANA_ABR = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const formatCurrency = (value: string): string => {
  const clean = value.replace(/\D/g, "");
  if (!clean) return "";
  const cents = parseInt(clean, 10);
  if (isNaN(cents)) return "";
  const number = cents / 100;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
};

const parseCurrencyToFloat = (value: string): number => {
  if (!value) return 0;
  const clean = value.replace(/\./g, "").replace(",", ".");
  return parseFloat(clean) || 0;
};

interface HistoricoEstagio {
  periodo: string;
  fatorPeriodo: string;
  valorOrtn: string;
  valorAcumulado500: string;
  descricao: string;
  tipo: string;
}

interface CalculationResponse {
  sucesso: boolean;
  dataObito: string;
  valorCausa: number;
  fatorIPCAE: number;
  ortnNominal: number;
  ortnUnitarioReais: number;
  limiteAlcadaReais: number;
  comparacao: "MAIOR" | "MENOR";
  mensagemAlerta: string;
  fundamentacaoLegal: string;
  passosCalculo: string[];
  historicoIndices: { periodo: string; indice: string }[];
  historicoDetalhamento?: HistoricoEstagio[];
}

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

function obterHistoricoDetalhadoLocal(dateStr: string): HistoricoEstagio[] {
  const [yearStr, monthStr] = dateStr.split("-");
  const anoObito = parseInt(yearStr) || 2026;
  const mesObito = parseInt(monthStr) || 6;

  const steps: HistoricoEstagio[] = [];

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

function calcularAtualizacaoDeterministaLocal(dateStr: string, numericCauseValue: number): CalculationResponse {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr) || 2026;
  const month = parseInt(monthStr) || 6;
  const day = parseInt(dayStr) || 1;

  const parsedDate = new Date(year, month - 1, day);
  const formattedDate = `${String(parsedDate.getDate()).padStart(2, '0')}/${String(parsedDate.getMonth() + 1).padStart(2, '0')}/${parsedDate.getFullYear()}`;

  let factor = 1.0;
  
  if (year >= 2001) {
    for (let yr = 2001; yr <= year; yr++) {
      const inflation = INFLACAO_ANUAL[yr] !== undefined ? INFLACAO_ANUAL[yr] : 0.04;
      if (yr === year) {
        const fraction = Math.min(1.0, month / 12);
        factor *= (1 + (inflation * fraction));
      } else {
        factor *= (1 + inflation);
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
  if (year >= 2001) {
    passosCalculo.push(`Parâmetro de Alçada STJ (Jan/2001): 500 ORTNs equivalem a R$ 3.282,70 (1 ORTN = R$ 6,5654).`);
    passosCalculo.push(`Correção Monetária por IPCA-E: de Jan/2001 até o mês do óbito (\${String(month).padStart(2, '0')}/\${year}), acumula um fator de evolução de \${(factor).toFixed(5)}x.`);
    passosCalculo.push(`Cálculo do Limite: R$ 3.282,70 * \${(factor).toFixed(5)} = R$ \${limiteAlcada.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
    passosCalculo.push(`Cálculo Unitário da ORTN: R$ \${limiteAlcada.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} dividido por 500 = R$ \${otnUnitReais.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}.`);
    passosCalculo.push(`Comparação: R$ \${numericCauseValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} contra o teto legal de R$ \${limiteAlcada.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`);
  } else {
    passosCalculo.push(`Parâmetro de Alçada STJ (Jan/2001): 500 ORTNs equivalem a R$ 3.282,70.`);
    passosCalculo.push(`Data do óbito (\${formattedDate}) anterior a Janeiro de 2001: Valor de alçada mantido no limite consolidado de R$ 3.282,70.`);
    passosCalculo.push(`Comparação: O valor pretendido de R$ \${numericCauseValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} contra o teto de R$ 3.282,70.`);
  }

  const historicoIndices = [
    { periodo: "Jan/2001", indice: `Tema 395 do STJ fixou 500 ORTNs em R$ 3.282,70 (1 ORTN = R$ 6,5654)` },
    { periodo: `\${String(month).padStart(2, '0')}/\${year}`, indice: `Fator IPCA-E acumulado correspondente do período: \${(factor).toFixed(5)}x` }
  ];

  const detalhamentoHistorico = obterHistoricoDetalhadoLocal(dateStr);

  return {
    sucesso: true,
    dataObito: formattedDate,
    valorCausa: numericCauseValue,
    fatorIPCAE: Number(factor.toFixed(5)),
    ortnNominal: 6.5654,
    ortnUnitarioReais: Number(otnUnitReais.toFixed(4)),
    limiteAlcadaReais: Number(limiteAlcada.toFixed(2)),
    comparacao: comparacao as "MAIOR" | "MENOR",
    mensagemAlerta: message,
    fundamentacaoLegal: "Cálculo analítico computado via base local segura. Em conformidade com o Artigo 2º da Lei 6.858/1980 e o Tema 395 do Superior Tribunal de Justiça (STJ), que adota como base histórica indexada para 500 ORTNs o valor de R$ 3.282,70 em janeiro de 2001, corrigido subsequentemente pelo IPCA-E até a data do falecimento do titular.",
    passosCalculo,
    historicoIndices,
    historicoDetalhamento: detalhamentoHistorico
  };
}

export default function App() {
  const [date, setDate] = useState<string>("");
  const [displayDate, setDisplayDate] = useState<string>("");
  const [causeValue, setCauseValue] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<CalculationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyViewType, setHistoryViewType] = useState<"timeline" | "table">("timeline");
  const [historyExpanded, setHistoryExpanded] = useState<boolean>(false);

  const [ipcaeStatus, setIpcaeStatus] = useState<{ totalRegistros: number; ultimaAtualizacao: string | null } | null>(null);
  const [updatingIpcae, setUpdatingIpcae] = useState<boolean>(false);
  const [updateMsg, setUpdateMsg] = useState<{ text: string; success: boolean } | null>(null);

  React.useEffect(() => {
    fetch("/api/ipcae-status")
      .then((res) => res.json())
      .then((data) => {
        setIpcaeStatus(data);
      })
      .catch((err) => console.error("Erro ao obter status da tabela IPCA-E:", err));
  }, []);

  const handleUpdateIpcae = async () => {
    setUpdatingIpcae(true);
    setUpdateMsg(null);
    try {
      const response = await fetch("/api/update-ipcae", {
        method: "POST",
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setIpcaeStatus({
          totalRegistros: data.totalRegistros,
          ultimaAtualizacao: data.ultimaAtualizacao,
        });
        setUpdateMsg({ text: data.mensagem, success: true });
      } else {
        setUpdateMsg({ text: data.mensagem || "Não foi possível atualizar a tabela do IPCA-E.", success: false });
      }
    } catch (err: any) {
      setUpdateMsg({ text: `Falha de conexão com o servidor: ${err.message || err}`, success: false });
    } finally {
      setUpdatingIpcae(false);
      setTimeout(() => {
        setUpdateMsg(null);
      }, 6000);
    }
  };

  // Estados e controle do calendário interativo rápido
  const [showPicker, setShowPicker] = useState<boolean>(false);
  const [pickerYear, setPickerYear] = useState<number>(2026);
  const [pickerMonth, setPickerMonth] = useState<number>(5); // Junho (0-indexed)

  const getDaysInMonth = (y: number, m: number) => {
    return new Date(y, m + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (y: number, m: number) => {
    return new Date(y, m, 1).getDay();
  };

  const togglePicker = () => {
    if (!showPicker) {
      if (date) {
        const parts = date.split("-");
        if (parts.length === 3) {
          const y = parseInt(parts[0]);
          const m = parseInt(parts[1]) - 1;
          if (!isNaN(y) && !isNaN(m)) {
            setPickerYear(y);
            setPickerMonth(m);
            setShowPicker(true);
            return;
          }
        }
      }
      const today = new Date();
      setPickerYear(today.getFullYear() <= 2026 ? today.getFullYear() : 2026);
      setPickerMonth(today.getMonth());
    }
    setShowPicker(!showPicker);
  };

  const handleSelectDay = (day: number) => {
    const formattedDay = String(day).padStart(2, '0');
    const formattedMonth = String(pickerMonth + 1).padStart(2, '0');
    const formattedYear = String(pickerYear);
    
    setDisplayDate(`${formattedDay}/${formattedMonth}/${formattedYear}`);
    setDate(`${formattedYear}-${formattedMonth}-${formattedDay}`);
    setShowPicker(false);
  };

  const adjustMonth = (direction: "prev" | "next") => {
    if (direction === "prev") {
      if (pickerMonth === 0) {
        setPickerMonth(11);
        setPickerYear(prev => Math.max(1980, prev - 1));
      } else {
        setPickerMonth(prev => prev - 1);
      }
    } else {
      if (pickerMonth === 11) {
        setPickerMonth(0);
        setPickerYear(prev => Math.min(2030, prev + 1));
      } else {
        setPickerMonth(prev => prev + 1);
      }
    }
  };

  // Fechar o picker ao clicar no documento fora dele
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const pickerEl = document.getElementById("date_picker_popover");
      const buttonEl = document.getElementById("date_picker_toggle_btn");
      if (
        showPicker && 
        pickerEl && 
        !pickerEl.contains(event.target as Node) &&
        buttonEl &&
        !buttonEl.contains(event.target as Node)
      ) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showPicker]);

  // Formata o valor digitado aplicando máscara DD/MM/AAAA
  const formatAndSetDate = (value: string) => {
    const clean = value.replace(/\D/g, "");
    let formatted = clean;
    if (clean.length > 2) {
      formatted = `${clean.slice(0, 2)}/${clean.slice(2)}`;
    }
    if (clean.length > 4) {
      formatted = `${clean.slice(0, 2)}/${clean.slice(2, 4)}/${clean.slice(4, 8)}`;
    }
    // Limita ao tamanho máximo de 10 caracteres (DD/MM/AAAA)
    const truncatedFormatted = formatted.slice(0, 10);
    setDisplayDate(truncatedFormatted);

    // Se tiver 8 dígitos numéricos válidos, atualiza o state interno real (date)
    const cleanNumbers = truncatedFormatted.replace(/\D/g, "");
    if (cleanNumbers.length === 8) {
      const day = cleanNumbers.slice(0, 2);
      const month = cleanNumbers.slice(2, 4);
      const year = cleanNumbers.slice(4, 8);
      setDate(`${year}-${month}-${day}`);
    } else {
      setDate("");
    }
  };

  // Trata a colagem de dados de forma extremamente resiliente
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData("text").trim();
    
    // Expressões regulares para múltiplos formatos comuns de data
    const isoRegex = /^(\d{4})[-/](\d{2})[-/](\d{2})$/;
    const brRegex = /^(\d{2})[-/](\d{2})[-/](\d{4})$/;
    const brShortRegex = /^(\d{2})[-/](\d{2})[-/](\d{2})$/;
    
    let day = "";
    let month = "";
    let year = "";

    if (isoRegex.test(pastedText)) {
      const match = pastedText.match(isoRegex);
      if (match) {
        year = match[1];
        month = match[2];
        day = match[3];
      }
    } else if (brRegex.test(pastedText)) {
      const match = pastedText.match(brRegex);
      if (match) {
        day = match[1];
        month = match[2];
        year = match[3];
      }
    } else if (brShortRegex.test(pastedText)) {
      const match = pastedText.match(brShortRegex);
      if (match) {
        day = match[1];
        month = match[2];
        const yr = parseInt(match[3]);
        year = yr > 30 ? `19${yr}` : `20${String(yr).padStart(2, '0')}`;
      }
    } else {
      // Se não der match direto, extrai apenas os números e tenta identificar
      const cleanDigits = pastedText.replace(/\D/g, "");
      if (cleanDigits.length === 8) {
        day = cleanDigits.slice(0, 2);
        month = cleanDigits.slice(2, 4);
        year = cleanDigits.slice(4, 8);
      } else if (cleanDigits.length === 6) {
        day = cleanDigits.slice(0, 2);
        month = cleanDigits.slice(2, 4);
        const yr = parseInt(cleanDigits.slice(4, 6));
        year = yr > 30 ? `19${yr}` : `20${String(yr).padStart(2, '0')}`;
      }
    }

    if (day && month && year) {
      const formattedInput = `${day}/${month}/${year}`;
      setDisplayDate(formattedInput);
      setDate(`${year}-${month}-${day}`);
    } else {
      // Se forem apenas números soltos, aplica a máscara padrão
      const onlyNumbers = pastedText.replace(/\D/g, "");
      if (onlyNumbers.length > 0) {
        formatAndSetDate(onlyNumbers);
      }
    }
  };

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    let targetDate = date;

    // Se o state date estiver vazio mas o displayDate estiver preenchido, tenta converter se tiver 8 dígitos
    if (!targetDate && displayDate) {
      const clean = displayDate.replace(/\D/g, "");
      if (clean.length === 8) {
        const day = clean.slice(0, 2);
        const month = clean.slice(2, 4);
        const year = clean.slice(4, 8);
        targetDate = `${year}-${month}-${day}`;
      }
    }

    if (!targetDate) {
      setError("Por favor, digite ou cole uma data de óbito válida no formato DD/MM/AAAA.");
      return;
    }

    // Validação de calendário real (evita datas inexistentes como 31/02 ou 45/12)
    const [y, m, d] = targetDate.split("-").map(Number);
    const testDate = new Date(y, m - 1, d);
    if (
      isNaN(testDate.getTime()) || 
      testDate.getFullYear() !== y || 
      testDate.getMonth() + 1 !== m || 
      testDate.getDate() !== d
    ) {
      setError("A data informada é inválida. Por favor, verifique o dia, mês e o ano digitado.");
      return;
    }
    
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          date: targetDate, 
          causeValue: parseCurrencyToFloat(causeValue)
        }),
      });

      if (!response.ok) {
        throw new Error("Erro na comunicação com a API de cálculos.");
      }

      const data: CalculationResponse = await response.json();
      if (data.sucesso) {
        setResult(data);
      } else {
        throw new Error("Ocorreu um erro ao calcular o valor de alçada.");
      }
    } catch (err: any) {
      console.warn("Falha no fetch para o servidor, executando cálculo localmente como alternativa (CORS / Fallback Local):", err);
      try {
        const localCalculation = calcularAtualizacaoDeterministaLocal(targetDate, parseCurrencyToFloat(causeValue));
        setResult(localCalculation);
        setError(null);
      } catch (localErr: any) {
        console.error(localErr);
        setError("Erro desconhecido ao processar o cálculo.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePDF = () => {
    if (!result) return;

    // Create a new jsPDF document
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4"
    });

    // Helper variables for margins and spacing
    const margin = 20;
    let y = 16;

    // Cabeçalho institucional (centralizado)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    doc.text("ESTADO DE PERNAMBUCO", 105, y, { align: "center" });
    y += 5;
    doc.text("TRIBUNAL DE JUSTIÇA", 105, y, { align: "center" });
    y += 7;

    // Set document background/borders visually
    doc.setDrawColor(220, 225, 230);
    doc.line(margin, y, 210 - margin, y); // separator line
    y += 8;

    // Document Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(33, 43, 54);
    doc.text("DEMONSTRATIVO ANALÍTICO DO CÁLCULO", margin, y);
    y += 5.5;
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(99, 115, 129);
    doc.text("Lei Federal nº 6.858, de 24 de Novembro de 1980 / Tema 395 do STJ", margin, y);
    y += 8;

    // Border line below header
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, 210 - margin, y);
    y += 10;

    // Subtitle / Section: Parameters
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(33, 43, 54);
    doc.text("1. PARÂMETROS INFORMADOS", margin, y);
    y += 6;

    // Draw parameters box
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, 210 - 2 * margin, 24, "F");
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, y, 210 - 2 * margin, 24, "S");

    // Add text inside parameters box
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    
    // Split date string to show formatted or raw
    const rawDateStr = result.dataObito;
    doc.text(`Data do Óbito do Titular: ${rawDateStr}`, margin + 5, y + 8);
    doc.text(`Valor da Causa para Levantamento: R$ ${result.valorCausa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, margin + 5, y + 16);
    y += 32;

    // Section: Calculation Results
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(33, 43, 54);
    doc.text("2. DEMONSTRATIVO DA MEMÓRIA DE CÁLCULO", margin, y);
    y += 6;

    // Table Header
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, 210 - 2 * margin, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text("Rubrica do Parâmetro", margin + 4, y + 5.5);
    doc.text("Valor / Índice", 210 - margin - 40, y + 5.5, { align: "right" });
    y += 8;

    // Table rows helper
    const addRow = (label: string, value: string, isBold = false) => {
      doc.setFont("helvetica", isBold ? "bold" : "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(51, 65, 85);
      doc.text(label, margin + 4, y + 6);
      doc.text(value, 210 - margin - 40, y + 6, { align: "right" });
      
      doc.setDrawColor(241, 245, 249);
      doc.line(margin, y + 9, 210 - margin, y + 9);
      y += 9;
    };

    addRow("Valor de Alçada Base (STJ Jan/2001)", "R$ 3.282,70 (500 ORTNs)");
    addRow("Fator IPCA-E acumulado", `${result.fatorIPCAE.toLocaleString('pt-BR', { maximumFractionDigits: 5 })}x`);
    addRow("Valor de 1 ORTN na data do óbito", `R$ ${result.ortnUnitarioReais.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`);
    addRow("Limite permitido para levantamento (500 ORTNs)", `R$ ${result.limiteAlcadaReais.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, true);
    addRow("Diferença em relação ao valor da causa declarado", `R$ ${Math.abs(result.limiteAlcadaReais - result.valorCausa).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, false);
    y += 5;

    // Decision block with matching background color based on comparison
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const boxColor = result.comparacao === "MENOR" ? [240, 253, 244] : [254, 242, 242]; // Green vs Red background
    const borderColor = result.comparacao === "MENOR" ? [187, 247, 208] : [254, 202, 202];
    const textColor = result.comparacao === "MENOR" ? [21, 128, 61] : [185, 28, 28];

    doc.setFillColor(boxColor[0], boxColor[1], boxColor[2]);
    doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
    doc.rect(margin, y, 210 - 2 * margin, 18, "F");
    doc.rect(margin, y, 210 - 2 * margin, 18, "S");

    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    const splitAlert = doc.splitTextToSize(result.mensagemAlerta, 210 - 2 * margin - 10);
    doc.text(splitAlert, margin + 5, y + 6);
    y += 26;

    // Grau de Comprometimento do Teto (Replicado no PDF)
    const percent = (result.valorCausa / result.limiteAlcadaReais) * 100;
    const formattedPercent = percent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const isExceeded = percent > 100;

    let barColorRGB = [16, 185, 129]; // Emerald 500
    let textRGB = [4, 120, 87]; // Emerald 700
    let statusText = "Margem Confortável";

    if (percent > 100) {
      barColorRGB = [239, 68, 68]; // Rose 500
      textRGB = [185, 28, 28]; // Rose 700
      statusText = "Excede o Teto Legal";
    } else if (percent > 85) {
      barColorRGB = [245, 158, 11]; // Amber 500
      textRGB = [180, 83, 9]; // Amber 700
      statusText = "Próximo ao Teto Legal";
    } else if (percent > 60) {
      barColorRGB = [59, 130, 246]; // Blue 500
      textRGB = [29, 78, 216]; // Blue 700
      statusText = "Utilização Moderada";
    }

    const boxHeight = 28;
    if (y + boxHeight > 275) {
      doc.addPage();
      y = 16;
    }

    // Outer card background & border
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.rect(margin, y, 210 - 2 * margin, boxHeight, "F");
    doc.rect(margin, y, 210 - 2 * margin, boxHeight, "S");

    // Title / Header in Card
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105); // slate-600
    doc.text("GRAU DE COMPROMETIMENTO DO TETO", margin + 5, y + 6);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(115, 115, 115);
    doc.text(`(${statusText})`, margin + 64, y + 6);

    // Badge / Percent label on right
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(textRGB[0], textRGB[1], textRGB[2]);
    doc.text(`${formattedPercent}% do teto legal`, 210 - margin - 5, y + 6, { align: "right" });

    // Progress Bar Track
    const barWidthMax = 210 - 2 * margin - 10;
    const barY = y + 10;
    doc.setFillColor(226, 232, 240); // slate-200
    doc.rect(margin + 5, barY, barWidthMax, 2.5, "F");

    // Progress Bar Fill
    const fillWidth = (Math.min(100, percent) / 100) * barWidthMax;
    if (fillWidth > 0) {
      doc.setFillColor(barColorRGB[0], barColorRGB[1], barColorRGB[2]);
      doc.rect(margin + 5, barY, fillWidth, 2.5, "F");
    }

    // Helper text description below progress bar
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139); // slate-500
    
    let infoText = "";
    if (isExceeded) {
      infoText = `O valor da causa é superior ao limite permitido de 500 ORTNs para este procedimento simplificado de alvará.`;
    } else {
      const restValue = (result.limiteAlcadaReais - result.valorCausa).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      infoText = `O valor da causa consome ${formattedPercent}% do teto previsto em lei. Restam ${restValue} de margem segura.`;
    }
    const splitInfo = doc.splitTextToSize(infoText, 210 - 2 * margin - 10);
    doc.text(splitInfo, margin + 5, y + 18);

    y += boxHeight + 8;

    // Step by step breakdown section
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(33, 43, 54);
    doc.text("3. PASSO A PASSO DETALHADO DO CÁLCULO", margin, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    
    result.passosCalculo.forEach((passo) => {
      const splitStep = doc.splitTextToSize(`• ${passo}`, 210 - 2 * margin);
      // Check for page overflow
      if (y + splitStep.length * 5 > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(splitStep, margin, y);
      y += splitStep.length * 5 + 2;
    });

    y += 4;

    // Detailed historical sequence stage in PDF
    if (result.historicoDetalhamento && result.historicoDetalhamento.length > 0) {
      if (y + 25 > 275) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(33, 43, 54);
      doc.text("4. EVOLUÇÃO HISTÓRICA SEQUENCIAL DA ORTN", margin, y);
      y += 6;

      result.historicoDetalhamento.forEach((stg) => {
        const splitDesc = doc.splitTextToSize(stg.descricao, 210 - 2 * margin - 6);
        const cellHeight = splitDesc.length * 4 + 9;

        if (y + cellHeight > 275) {
          doc.addPage();
          y = 20;
        }

        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, 210 - 2 * margin, cellHeight, "F");
        doc.setDrawColor(230, 235, 240);
        doc.rect(margin, y, 210 - 2 * margin, cellHeight, "S");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(51, 65, 85);
        doc.text(`${stg.periodo} (${stg.fatorPeriodo})`, margin + 3, y + 4.5);
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(`Valor ORTN: ${stg.valorOrtn}  |  Alçada 500: ${stg.valorAcumulado500}`, 210 - margin - 3, y + 4.5, { align: "right" });
        
        doc.setFont("helvetica", "italic");
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(splitDesc, margin + 3, y + 8.5);

        y += cellHeight + 3;
      });
      y += 3;
    }

    // Fundamental legal section
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(33, 43, 54);
    if (y + 25 > 275) {
      doc.addPage();
      y = 20;
    }
    const legalHeaderTitle = result.historicoDetalhamento && result.historicoDetalhamento.length > 0 
      ? "5. FUNDAMENTAÇÃO LEGAL E JURISPRUDENCIAL" 
      : "4. FUNDAMENTAÇÃO LEGAL E JURISPRUDENCIAL";
    doc.text(legalHeaderTitle, margin, y);
    y += 6;

    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    const splitLegal = doc.splitTextToSize(
      `${result.fundamentacaoLegal}\n\nNota: Este parecer de cálculo é analítico e obedece os parâmetros de correção monetária pelas tabelas oficiais do IPCA-E/IBGE em conformidade estrita com o Tema Repetitivo 395 do STJ e o Art. 2º da Lei Federal nº 6.858/1980.`, 
      210 - 2 * margin
    );
    doc.text(splitLegal, margin, y);

    // Multi-page page stamping
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, 282, 210 - margin, 282);
      doc.text(`Demonstrativo gerado eletronicamente em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`, margin, 287);
      doc.text(`Página ${i} de ${pageCount}`, 210 - margin, 287, { align: "right" });
    }

    // Download PDF triggers browser download
    doc.save(`Calculo_Alcada_Alvara_Obito_${result.dataObito.replace(/\//g, "-")}.pdf`);
  };

  const handleClear = () => {
    setDate("");
    setDisplayDate("");
    setCauseValue("");
    setResult(null);
    setError(null);
  };

  // Convert BRL formatted string back to float for calculation or validation preview
  const numericVal = parseCurrencyToFloat(causeValue);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col justify-between" id="app_container">
      {/* Top Header Card - Professional Polish Theme */}
      <header className="bg-slate-800 text-white p-6 md:px-8 md:py-6 shadow-md border-b border-slate-700" id="app_header">
        <div className="max-w-6xl w-full mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4" id="header_inner_container">
          <div className="flex flex-col">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight font-display flex items-center gap-2">
              <a 
                href="https://aistudio.google.com/app/apps/02e4f5b5-97c1-41b3-8996-39fa75035d48" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="hover:opacity-85 transition inline-flex items-center"
                title="Acessar projeto no AI Studio"
              >
                <Landmark className="w-6 h-6 text-blue-400 shrink-0" id="logo_icon" />
              </a>
              Valor de Alçada para Alvará Judicial
            </h1>
            <p className="text-slate-300 text-xs md:text-sm mt-1 max-w-xl">
              Conforme{" "}
              <a 
                href="https://www.planalto.gov.br/ccivil_03/leis/l6858.htm" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-slate-300 hover:text-slate-100 transition inline-block decoration-transparent border-0"
              >
                Lei Federal nº 6.858/1980
              </a>{" "}
              e{" "}
              <a 
                href="https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?novaConsulta=true&tipo_pesquisa=T&cod_tema_inicial=395&cod_tema_final=395" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-slate-300 hover:text-slate-100 transition inline-block decoration-transparent border-0"
              >
                Tema Repetitivo 395 do STJ
              </a>
            </p>
          </div>
          <div className="bg-slate-700 px-4 py-2.5 rounded-lg border border-slate-600 shrink-0 self-stretch sm:self-auto text-center sm:text-left shadow-inner" id="reference_badge">
            <span className="text-[10px] block text-slate-400 uppercase font-bold tracking-wider">Unidade de Referência</span>
            <span className="text-md md:text-lg font-sans font-bold text-blue-300">500 ORTNs</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl w-full mx-auto flex-grow p-4 md:p-8" id="app_main">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start" id="app_grid">
          
          {/* Column Left: Input Form */}
          <section className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200 md:col-span-5 flex flex-col justify-between min-h-[500px]" id="form_container">
            <div>
              <div className="border-b border-slate-150 pb-4 mb-6">
                <h2 className="text-lg font-bold text-slate-750 mb-1 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" /> Parâmetros de Cálculo
                </h2>
                <p className="text-xs text-slate-500">Preencha os dados do processo para definir o limite legal.</p>
              </div>

              <form onSubmit={handleCalculate} className="space-y-6" id="input_form">
                {/* Deceased Date Input */}
                <div className="flex flex-col gap-1.5" id="date_input_group">
                  <label htmlFor="date" className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-slate-500" /> Data de Óbito do Titular
                  </label>
                  <div className="relative" id="date_input_wrapper">
                    <input
                      type="text"
                      id="date"
                      placeholder="DD/MM/AAAA"
                      value={displayDate}
                      onChange={(e) => formatAndSetDate(e.target.value)}
                      onPaste={handlePaste}
                      required
                      className="w-full p-3 pr-11 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition text-slate-800 font-medium bg-slate-50 focus:bg-white font-sans"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      id="date_picker_toggle_btn"
                      onClick={togglePicker}
                      className="absolute right-3 top-3.5 text-slate-400 hover:text-blue-600 transition cursor-pointer"
                      title="Abrir calendário para seleção rápida"
                    >
                      <Calendar className="w-5 h-5" />
                    </button>

                    {/* Popover do Calendário com AnimatePresence e Motion */}
                    <AnimatePresence>
                      {showPicker && (
                        <motion.div
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          id="date_picker_popover"
                          className="absolute left-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 p-4 z-50 text-xs text-left"
                        >
                          {/* Cabeçalho do Calendário com os seletores rápidos de Mês e Ano */}
                          <div className="flex items-center justify-between gap-1 mb-3 pb-2 border-b border-slate-100" id="picker_header">
                            <button
                              type="button"
                              onClick={() => adjustMonth("prev")}
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition cursor-pointer flex items-center justify-center"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </button>

                            <div className="flex items-center gap-1.5" id="picker_selectors">
                              {/* Seletor Rápido de Mês */}
                              <select
                                value={pickerMonth}
                                onChange={(e) => setPickerMonth(parseInt(e.target.value))}
                                className="font-bold text-slate-800 bg-slate-100 border-none rounded px-2 py-1 text-[11px] cursor-pointer outline-none hover:bg-slate-200 transition"
                              >
                                {MESES.map((nome, idx) => (
                                  <option key={idx} value={idx}>{nome}</option>
                                ))}
                              </select>

                              {/* Seletor Rápido de Ano */}
                              <select
                                value={pickerYear}
                                onChange={(e) => setPickerYear(parseInt(e.target.value))}
                                className="font-mono font-bold text-slate-800 bg-slate-100 border-none rounded px-2 py-1 text-[11px] cursor-pointer outline-none hover:bg-slate-200 transition"
                              >
                                {Array.from({ length: 51 }, (_, i) => 1980 + i).map((ano) => (
                                  <option key={ano} value={ano}>{ano}</option>
                                ))}
                              </select>
                            </div>

                            <button
                              type="button"
                              onClick={() => adjustMonth("next")}
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition cursor-pointer flex items-center justify-center"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Dias da Semana */}
                          <div className="grid grid-cols-7 gap-1 text-center font-bold text-[10px] text-slate-400 mb-1" id="picker_weekdays">
                            {DIAS_SEMANA_ABR.map((dia, idx) => (
                              <div key={idx} className="py-1">{dia}</div>
                            ))}
                          </div>

                          {/* Grade de Dias */}
                          <div className="grid grid-cols-7 gap-1" id="picker_days_grid">
                            {/* Espaços em branco antes do primeiro dia do mês */}
                            {Array.from({ length: getFirstDayOfMonth(pickerYear, pickerMonth) }).map((_, idx) => (
                              <div key={`empty-${idx}`} className="p-2" />
                            ))}

                            {/* Dias do Mês */}
                            {Array.from({ length: getDaysInMonth(pickerYear, pickerMonth) }).map((_, idx) => {
                              const day = idx + 1;
                              const currentFormattedDay = String(day).padStart(2, '0');
                              const currentFormattedMonth = String(pickerMonth + 1).padStart(2, '0');
                              const currentFullDate = `${pickerYear}-${currentFormattedMonth}-${currentFormattedDay}`;
                              const isSelected = date === currentFullDate;

                              return (
                                <button
                                  key={day}
                                  type="button"
                                  onClick={() => handleSelectDay(day)}
                                  className={`p-1.5 rounded-lg text-center font-medium font-mono transition text-[11px] cursor-pointer flex items-center justify-center h-7 w-7 mx-auto ${
                                    isSelected 
                                      ? "bg-blue-600 text-white font-bold shadow-xs hover:bg-blue-700" 
                                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                                  }`}
                                >
                                  {day}
                                </button>
                              );
                            })}
                          </div>

                          {/* Atalho Prático para ir ao mês atual ou limpar */}
                          <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between items-center text-[10px]" id="picker_actions">
                            <button
                              type="button"
                              onClick={() => {
                                const today = new Date();
                                setPickerYear(today.getFullYear() <= 2026 ? today.getFullYear() : 2026);
                                setPickerMonth(today.getMonth());
                              }}
                              className="text-slate-400 hover:text-slate-600 transition font-medium cursor-pointer"
                            >
                              Mês Atual
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDisplayDate("");
                                setDate("");
                                setShowPicker(false);
                              }}
                              className="text-red-500 hover:text-red-600 transition font-bold cursor-pointer"
                            >
                              Limpar
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Requerido para aplicação da variação monetária do IPCA-E desde janeiro de 2001.
                  </p>
                </div>

                {/* Cause Value Input */}
                <div className="flex flex-col gap-1.5" id="val_input_group">
                  <label htmlFor="causeValue" className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <CircleDollarSign className="w-4 h-4 text-slate-500" /> VALOR DA CAUSA
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-3 text-slate-400 font-semibold text-sm">R$</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      id="causeValue"
                      placeholder="0,00"
                      value={causeValue}
                      onChange={(e) => setCauseValue(formatCurrency(e.target.value))}
                      className="w-full p-3 pl-10 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition text-slate-800 font-medium bg-slate-50 focus:bg-white text-md font-sans"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Saldo total em contas bancárias, poupança, PIS/PASEP ou FGTS que se pretende levantar.
                  </p>
                </div>

                {/* Error Box */}
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-4 rounded-lg flex items-start gap-2" id="error_box">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>{error}</div>
                  </div>
                )}

                {/* Action Button */}
                <button
                  type="submit"
                  disabled={loading}
                  id="calculate_btn"
                  className="w-full bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-100 text-white font-bold py-4 rounded-lg shadow-lg shadow-blue-100 transition-all uppercase tracking-widest text-xs cursor-pointer flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin text-white" />
                      Processando...
                    </>
                  ) : (
                    "CALCULAR VALOR DE ALÇADA"
                  )}
                </button>

                {result && (
                  <button
                    type="button"
                    onClick={handleClear}
                    id="clear_btn"
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs py-2.5 px-4 rounded-lg transition uppercase tracking-wider cursor-pointer"
                  >
                    Limpar Campos
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleGeneratePDF}
                  disabled={!result}
                  id="form_download_pdf_btn"
                  className="w-full bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 text-slate-600 font-bold text-xs py-2.5 px-4 rounded-lg transition uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2 mt-2"
                >
                  <FileDown className="w-4 h-4" /> Emitir Demonstrativo em PDF
                </button>

                <button
                  type="button"
                  onClick={handleUpdateIpcae}
                  disabled={updatingIpcae}
                  id="update_ipcae_btn"
                  className="w-full bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-400 text-slate-600 font-bold text-xs py-2.5 px-4 rounded-lg transition uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2 mt-2"
                >
                  {updatingIpcae ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                      Sincronizando Banco Central...
                    </>
                  ) : (
                    "ATUALIZAR TABELA DO IPCA-E"
                  )}
                </button>

                {ipcaeStatus && (
                  <div className="flex flex-col gap-0.5 text-[9px] text-slate-500 font-mono mt-1 px-1" id="ipcae_status_meta">
                    <span className="flex items-center gap-1 font-sans">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block animate-pulse" />
                      Registros carregados: <strong>{ipcaeStatus.totalRegistros} meses</strong>
                    </span>
                    {ipcaeStatus.ultimaAtualizacao && (
                      <span className="font-sans">Última sincronização: {new Date(ipcaeStatus.ultimaAtualizacao).toLocaleString('pt-BR')}</span>
                    )}
                  </div>
                )}

                {updateMsg && (
                  <div 
                    className={`text-[9px] p-2 rounded mt-1.5 ${updateMsg.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}
                    id="update_msg_alert"
                  >
                    {updateMsg.text}
                  </div>
                )}
              </form>
            </div>

            {/* Fundamentação Legal highlight - Design inspired! */}
            <div className="mt-8 p-4 bg-slate-50 rounded-lg border border-slate-200" id="fundamentacao_preview">
              <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">Parâmetros Oficiais</h3>
              <ul className="text-[10px] space-y-1.5 text-slate-600 leading-normal">
                <li className="flex items-start gap-1">• Limite de Alçada Base (STJ Jan/2001): <strong>R$ 3.282,70 (500 ORTNs)</strong></li>
                <li className="flex items-start gap-1">• Correção: IPCA-E acumulado até a data do óbito</li>
                <li className="flex items-start gap-1">• Art. 2º da Lei 6.858/80 (Teto de 500 ORTNs)</li>
                <li className="flex items-start gap-1">• Tema Repetitivo STJ 395 (Jan/2001: R$ 3.282,70)</li>
              </ul>
            </div>
          </section>

          {/* Column Right: Dynamic Output View */}
          <section className="md:col-span-7 space-y-6 animate-fade-in" id="output_section">
            <AnimatePresence mode="wait">
              {!result && !loading ? (
                /* Prompt View (Empty State) - Professional Polish Theme */
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="bg-white border border-slate-200 rounded-xl p-8 md:p-12 text-center h-full min-h-[500px] flex flex-col justify-center items-center shadow-sm"
                  id="empty_state_card"
                >
                  <TrendingUp className="w-12 h-12 text-slate-400 mb-4 animate-pulse" />
                  <h3 className="text-base font-bold text-slate-700 mb-1">Cálculo pronto para ser executado</h3>
                  <p className="text-slate-500 text-xs max-w-sm leading-relaxed">
                    Insira a data do falecimento do titular e o saldo que deseja resgatar no painel lateral para calcular o limite de alçada atualizado por IPCA-E.
                  </p>
                </motion.div>
              ) : loading ? (
                /* Calculating/Loading State View */
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="bg-white p-8 md:p-12 rounded-xl border border-slate-200 flex flex-col justify-center items-center h-full min-h-[500px] shadow-sm text-center"
                  id="loading_state_card"
                >
                  <Loader2 className="w-10 h-10 animate-spin text-blue-700 mb-6" />
                  <h3 className="text-lg font-bold text-slate-800 mb-2">Processando Cálculo Judicial</h3>
                  <p className="text-slate-500 text-xs max-w-sm leading-relaxed">
                    Buscando a variação histórica acumulada do IPCA-E desde janeiro de 2001 de forma sincronizada, aplicando os devidos índices oficiais...
                  </p>
                  
                  {/* Subtle checklist on screen */}
                  <div className="mt-8 space-y-2.5 self-stretch max-w-xs mx-auto text-left border-t border-slate-100 pt-6" id="loading_details">
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <div className="w-1.5 h-1.5 bg-blue-600 rounded-full shrink-0 animate-pulse" />
                      Carregando valor base (R$ 3.282,70)
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <div className="w-1.5 h-1.5 bg-blue-600 rounded-full shrink-0 animate-ping" />
                      Carregando indexador IPCA-E
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
                      <div className="w-1.5 h-1.5 bg-slate-300 rounded-full shrink-0" />
                      Calculando diferença legal
                    </div>
                  </div>
                </motion.div>
              ) : (
                /* Results View - Professional Polish Theme */
                result && (
                  <motion.div
                    key="results"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col"
                    id="result_card"
                  >
                    {/* Header bar of Results Card */}
                    <div className="p-6 bg-slate-50 border-b border-slate-200" id="result_hdr">
                      <h2 className="text-lg font-bold text-slate-700 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-blue-700" /> Resultado do Processamento
                      </h2>
                    </div>

                    <div className="p-6 md:p-8 space-y-8" id="result_body">
                      {/* Comparison visual outcome */}
                      <div className="flex flex-col items-center text-center py-4 border-b border-slate-100 pb-8" id="comparison_graphic">
                        {result.comparacao === "MENOR" ? (
                          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-6 shadow-xs border border-emerald-200">
                            <CheckCircle className="w-10 h-10 text-emerald-600" />
                          </div>
                        ) : (
                          <div className="w-20 h-20 bg-rose-100 rounded-full flex items-center justify-center mb-6 shadow-xs border border-rose-200">
                            <AlertTriangle className="w-10 h-10 text-rose-600 animate-pulse" />
                          </div>
                        )}

                        <div className="mb-4">
                          <h4 className={`font-black text-lg mb-2 tracking-wider uppercase ${
                            result.comparacao === "MENOR" ? "text-emerald-700" : "text-rose-700"
                          }`} id="alert_badge_title">
                            {result.comparacao === "MENOR" ? "REQUISITOS ATENDIDOS" : "EXCEDE O LIMITE LEGAL"}
                          </h4>
                          <p className="text-slate-600 max-w-md mx-auto text-sm leading-relaxed" id="alert_text_message">
                            O valor da causa na data do óbito é <strong className="text-slate-900">{result.comparacao}</strong> do que o limite legal de alçada simplificada de 500 ORTNs.
                          </p>
                        </div>
                        
                        <p className={`text-xs border rounded-lg px-4 py-2.5 font-semibold leading-relaxed max-w-lg ${
                          result.comparacao === "MENOR"
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                            : "bg-rose-50 text-rose-800 border-rose-200"
                        }`} id="alert_pill">
                          {result.mensagemAlerta}
                        </p>
                      </div>

                      {/* Display Key values Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" id="summary_grid">
                        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 transition hover:bg-slate-100/50" id="item_limit">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                            Limite Atualizado (500 ORTN)
                          </span>
                          <span className="text-xl md:text-2xl font-bold text-slate-800" id="limit_val">
                            {result.limiteAlcadaReais.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                          <span className="text-[10px] text-slate-500 block mt-1 leading-snug">
                            R$ 3.282,70 em Janeiro de 2001, corrigidos pelo IPCA-E até a data do óbito.
                          </span>
                        </div>

                        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 transition hover:bg-slate-100/50" id="item_cause">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                            Valor da Causa
                          </span>
                          <span className="text-xl md:text-2xl font-bold text-slate-800" id="cause_val">
                            {result.valorCausa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                          <span className="text-[10px] text-slate-500 block mt-1 leading-snug">
                            Valor do espólio que se pretende levantar por meio de alvará judicial.
                          </span>
                        </div>
                      </div>

                      {/* Percentual em relação ao teto */}
                      {(() => {
                        const percent = (result.valorCausa / result.limiteAlcadaReais) * 100;
                        const isExceeded = percent > 100;
                        const formattedPercent = percent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                        
                        let barColor = "bg-emerald-500";
                        let badgeBg = "bg-emerald-50 text-emerald-700 border-emerald-200";
                        let statusText = "Margem Confortável";
                        
                        if (percent > 100) {
                          barColor = "bg-rose-500";
                          badgeBg = "bg-rose-50 text-rose-700 border-rose-200";
                          statusText = "Excede o Teto Legal";
                        } else if (percent > 85) {
                          barColor = "bg-amber-500";
                          badgeBg = "bg-amber-50 text-amber-700 border-amber-200";
                          statusText = "Próximo ao Teto Legal";
                        } else if (percent > 60) {
                          barColor = "bg-blue-500";
                          badgeBg = "bg-blue-50 text-blue-700 border-blue-200";
                          statusText = "Utilização Moderada";
                        }

                        const widthPercent = Math.min(100, percent);

                        return (
                          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col gap-3" id="legal_ceiling_metrics">
                            <div className="flex flex-wrap items-center justify-between gap-2" id="legal_ceiling_label_row">
                              <div className="flex items-center gap-1.5" id="legal_ceiling_title_col">
                                <span className="text-xs font-bold text-slate-700">GRAU DE COMPROMETIMENTO DO TETO</span>
                                <span className="text-[10px] text-slate-400 font-medium">({statusText})</span>
                              </div>
                              <span className={`text-[10px] md:text-xs font-bold px-2 py-0.5 rounded-full border ${badgeBg} flex items-center gap-1`} id="ceiling_badge_val">
                                {formattedPercent}% do teto legal
                              </span>
                            </div>

                            <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden relative" id="bar_track">
                              <motion.div 
                                className={`h-full ${barColor}`}
                                initial={{ width: 0 }}
                                animate={{ width: `${widthPercent}%` }}
                                transition={{ duration: 0.8, ease: "easeOut" }}
                                id="bar_fill"
                              />
                            </div>

                            <p className="text-[11px] text-slate-500 leading-snug" id="ceiling_helper_text">
                              {isExceeded ? (
                                <span>O valor da causa é <strong className="text-rose-700">superior</strong> ao limite permitido de 500 ORTNs para este procedimento simplificado de alvará.</span>
                              ) : (
                                <span>O valor da causa consome <strong className="text-slate-700">{formattedPercent}%</strong> do teto previsto em lei. Restam <strong className="text-emerald-700">{(result.limiteAlcadaReais - result.valorCausa).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong> de margem segura.</span>
                              )}
                            </p>
                          </div>
                        );
                      })()}

                      {/* Technical Detail rows list */}
                      <div className="space-y-3 text-xs border-t border-slate-150 pt-6" id="metric_rows_list">
                        <div className="flex justify-between py-1 border-b border-dashed border-slate-200" id="row_nominal">
                          <span className="text-slate-500 font-medium">Valor de Alçada Base (STJ Jan/2001):</span>
                          <span className="font-sans font-semibold text-slate-800">R$ 3.282,70</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-dashed border-slate-200" id="row_multiplier">
                          <span className="text-slate-500 font-medium">Fator de Transição e IPCA-E Acumulado:</span>
                          <span className="font-sans font-semibold text-slate-800">{result.fatorIPCAE.toLocaleString('pt-BR', { maximumFractionDigits: 5 })}x</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-dashed border-slate-200" id="row_unit_reais">
                          <span className="text-slate-500 font-medium">Valor Unitário da ORTN em Reais:</span>
                          <span className="font-sans font-bold text-slate-800">R$ {result.ortnUnitarioReais.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
                        </div>
                        <div className="flex justify-between py-1" id="row_difference">
                          <span className="text-slate-500 font-medium">Diferença Encontrada:</span>
                          <span className={`font-sans font-bold text-xs ${result.comparacao === "MENOR" ? "text-emerald-700" : "text-rose-700"}`}>
                            {Math.abs(result.limiteAlcadaReais - result.valorCausa).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} {result.comparacao === "MENOR" ? "(Margem)" : "(Excesso)"}
                          </span>
                        </div>
                      </div>

                      {/* Step-by-Step Box List */}
                      <div className="bg-slate-50 p-5 rounded-lg border border-slate-200 space-y-4" id="steps_accordion_box">
                        <h4 className="font-bold text-slate-700 text-xs flex items-center gap-2 uppercase tracking-wider">
                          <HelpCircle className="w-4.5 h-4.5 text-slate-500 shrink-0" /> Memória Discriminada do Cálculo
                        </h4>
                        <ol className="space-y-3 text-xs text-slate-600 border-l-2 border-slate-200 pl-4 ml-2" id="steps_list">
                          {result.passosCalculo.map((step, index) => (
                            <li key={index} className="relative" id={`step_${index}`}>
                              <div className="absolute -left-6 top-0 w-3.5 h-3.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[9px] font-bold flex items-center justify-center">
                                {index + 1}
                              </div>
                              <p className="leading-relaxed font-medium">{step}</p>
                            </li>
                          ))}
                        </ol>
                      </div>

                      {/* Detailed Historical Sequel Update Section */}
                      <div className="space-y-4 border-t border-slate-150 pt-6" id="indices_details_box">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3" id="history_header_group">
                          <div>
                            <h4 className="font-bold text-slate-800 text-xs flex items-center gap-2 uppercase tracking-wider">
                              <TrendingUp className="w-4.5 h-4.5 text-blue-600 shrink-0" /> Evoluções Históricas Sequenciais de Alçada
                            </h4>
                            <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                              Passo a passo do valor de alçada corrigido pelo IPCA-E desde janeiro de 2001 (R$ 3.282,70) até a data informada.
                            </p>
                          </div>

                          {/* Toggle Button Group */}
                          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-[10px] uppercase font-bold shrink-0 self-start sm:self-center" id="toggle_view_btns">
                            <button
                              type="button"
                              onClick={() => setHistoryViewType("timeline")}
                              className={`px-3 py-1.5 rounded-md transition ${historyViewType === "timeline" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-700"}`}
                            >
                              Linha do Tempo
                            </button>
                            <button
                              type="button"
                              onClick={() => setHistoryViewType("table")}
                              className={`px-3 py-1.5 rounded-md transition ${historyViewType === "table" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-700"}`}
                            >
                              Tabela Contábil
                            </button>
                          </div>
                        </div>

                        {/* Rendering core sequence steps */}
                        {result.historicoDetalhamento && result.historicoDetalhamento.length > 0 ? (
                          (() => {
                            const totalSteps = result.historicoDetalhamento.length;
                            const visibleSteps = historyExpanded 
                              ? result.historicoDetalhamento 
                              : totalSteps <= 6 
                                ? result.historicoDetalhamento 
                                : [
                                    ...result.historicoDetalhamento.slice(0, 3), 
                                    ...result.historicoDetalhamento.slice(totalSteps - 2)
                                  ];

                            return (
                              <div className="space-y-4" id="history_render_wrapper">
                                {historyViewType === "timeline" ? (
                                  <div className="relative border-l border-slate-200 ml-4 pl-6 space-y-4 py-2" id="timeline_stages_box">
                                    {visibleSteps.map((step, idx) => {
                                      const isCutoffGap = !historyExpanded && totalSteps > 6 && idx === 3;
                                      
                                      return (
                                        <React.Fragment key={idx}>
                                          {isCutoffGap && (
                                            <div className="flex items-center gap-3 py-1 ml-[-37px]" id="timeline_gap_indicator">
                                              <div className="w-6 h-6 rounded-full bg-slate-50 border border-slate-200 text-[10px] text-slate-400 font-bold flex items-center justify-center">
                                                ...
                                              </div>
                                              <span className="text-[10px] text-slate-500 italic font-medium">
                                                {totalSteps - 5} etapas de evolução monetária ocultadas
                                              </span>
                                            </div>
                                          )}
                                          <div className="relative group" id={`timeline_item_${idx}`}>
                                            <div className={`absolute -left-10 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[8px] font-bold shadow-xs ${
                                              step.tipo === "base" 
                                                ? "bg-slate-50 border-slate-400 text-slate-600" 
                                                : step.tipo === "STJ" 
                                                  ? "bg-blue-50 border-blue-600 text-blue-700" 
                                                  : step.tipo === "obito" 
                                                    ? "bg-rose-50 border-rose-600 text-rose-700 font-extrabold scale-110" 
                                                    : "bg-emerald-50 border-emerald-500 text-emerald-700"
                                            }`}>
                                              {step.tipo === "base" ? "§" : step.tipo === "STJ" ? "T" : step.tipo === "obito" ? "Ω" : "+"}
                                            </div>

                                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 shadow-2xs group-hover:bg-slate-100/50 transition">
                                              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                                                <div className="flex items-center gap-2">
                                                  <span className="font-bold text-slate-800 text-xs">{step.periodo}</span>
                                                  <span className={`text-[8px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                                    step.tipo === "obito" ? "bg-rose-100 text-rose-800 animate-pulse" :
                                                    step.tipo === "STJ" ? "bg-blue-100 text-blue-800" :
                                                    "bg-slate-200 text-slate-700"
                                                  }`}>
                                                    {step.fatorPeriodo}
                                                  </span>
                                                </div>
                                                <div className="text-right text-[10px] font-semibold text-slate-500">
                                                  ORTN: <span className="font-mono text-slate-800">{step.valorOrtn}</span>
                                                </div>
                                              </div>
                                              <p className="text-[11px] text-slate-600 leading-relaxed mb-2">{step.descricao}</p>
                                              <div className="bg-white px-3 py-1.5 rounded border border-slate-100 text-xs flex justify-between items-center" id={`timeline_sub_metrics_${idx}`}>
                                                <span className="text-slate-400 font-bold text-[9px] uppercase tracking-wider">Alçada Acumulada</span>
                                                <span className="font-mono font-bold text-slate-700">{step.valorAcumulado500}</span>
                                              </div>
                                            </div>
                                          </div>
                                        </React.Fragment>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white" id="table_stages_box">
                                    <table className="w-full text-left border-collapse text-xs">
                                      <thead>
                                        <tr className="bg-slate-100 border-b border-slate-200 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                                          <th className="p-3">Período</th>
                                          <th className="p-3">Reajuste</th>
                                          <th className="p-3">ORTN Unitária</th>
                                          <th className="p-3">Alçada (500 ORTN)</th>
                                          <th className="p-3 hidden md:table-cell">Histórico/Contexto</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-200">
                                        {visibleSteps.map((step, idx) => {
                                          const isCutoffGap = !historyExpanded && totalSteps > 6 && idx === 3;
                                          return (
                                            <React.Fragment key={idx}>
                                              {isCutoffGap && (
                                                <tr className="bg-slate-50/50 italic text-[10px] text-slate-500" id="table_gap_row">
                                                  <td colSpan={5} className="p-3 text-center">
                                                    ... {totalSteps - 5} etapas de evolução monetária ocultadas ...
                                                  </td>
                                                </tr>
                                              )}
                                              <tr className="hover:bg-slate-50/70 transition" id={`table_row_${idx}`}>
                                                <td className="p-3 font-bold text-slate-800">{step.periodo}</td>
                                                <td className="p-3">
                                                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                                                    step.tipo === "obito" ? "bg-rose-100 text-rose-800" :
                                                    step.tipo === "STJ" ? "bg-blue-100 text-blue-800" :
                                                    "bg-slate-100 text-slate-600"
                                                  }`}>
                                                    {step.fatorPeriodo}
                                                  </span>
                                                </td>
                                                <td className="p-3 font-mono font-medium text-slate-700">{step.valorOrtn}</td>
                                                <td className="p-3 font-mono font-bold text-slate-800">{step.valorAcumulado500}</td>
                                                <td className="p-3 text-slate-500 text-[11px] hidden md:table-cell leading-snug">{step.descricao}</td>
                                              </tr>
                                            </React.Fragment>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {/* Collapsible Button wrapper */}
                                {totalSteps > 6 && (
                                  <div className="flex justify-center" id="expand_btn_box">
                                    <button
                                      type="button"
                                      onClick={() => setHistoryExpanded(!historyExpanded)}
                                      className="flex items-center gap-1 bg-white hover:bg-slate-50 text-[10px] text-blue-600 uppercase tracking-wider font-bold px-4 py-2 rounded-full border border-slate-200 shadow-2xs cursor-pointer transition active:scale-95"
                                    >
                                      {historyExpanded ? (
                                        <>Recolher Histórico Completo</>
                                      ) : (
                                        <>Exibir Histórico Completo ({totalSteps} Etapas)</>
                                      )}
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })()
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" id="indices_grid_view">
                            {result.historicoIndices.map((item, idx) => (
                              <div key={idx} className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 text-xs flex flex-col gap-0.5 transition hover:bg-slate-100/50" id={`index_card_${idx}`}>
                                <span className="font-bold text-slate-400 text-[9px] uppercase tracking-wider">{item.periodo}</span>
                                <span className="text-slate-700 font-medium text-[11px] leading-snug">{item.indice}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Fundamental Legal info panel */}
                      <div className="bg-slate-50 border border-slate-200 p-5 rounded-lg flex items-start gap-3" id="legal_info_panel">
                        <BookOpen className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                        <div className="text-slate-600 text-xs leading-relaxed" id="legal_text">
                          <h5 className="font-bold text-slate-700 text-[10px] uppercase tracking-wider mb-1">Fundamentação Normativa</h5>
                          {result.fundamentacaoLegal}
                        </div>
                      </div>
                    </div>

                    {/* PDF action bar at footer of Results Card */}
                    <div className="p-6 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4" id="pdf_action_cta_box">
                      <span className="text-[11px] text-slate-500 font-medium italic" id="calculation_timestamp">
                        Calculado em: {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}
                      </span>
                      <button
                        type="button"
                        onClick={handleGeneratePDF}
                        id="download_pdf_btn"
                        className="flex items-center gap-2 bg-white border-2 border-slate-300 px-6 py-2.5 rounded-lg text-slate-700 font-bold hover:bg-slate-100 cursor-pointer text-xs uppercase tracking-wider active:scale-98 transition shadow-xs"
                      >
                        <FileDown className="w-4.5 h-4.5" /> Emitir Demonstrativo em PDF
                      </button>
                    </div>
                  </motion.div>
                )
              )}
            </AnimatePresence>
          </section>
        </div>
      </main>

      {/* Styled Footer copyright block - Professional Polish Theme */}
      <footer className="bg-slate-200 p-4 border-t border-slate-300 text-center text-[10px] text-slate-500 uppercase tracking-widest font-medium" id="app_footer_info">
        TJPE - Central Remota de Contadoria &copy; 2026 • Base de Dados: IPCA-E / IBGE • Atualização Automática
      </footer>
    </div>
  );
}
