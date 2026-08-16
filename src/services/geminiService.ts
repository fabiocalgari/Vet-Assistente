import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface DiagnosisResult {
  diagnosis: string;
  treatment: string;
  medications: {
    name: string;
    dosage: string;
    frequency: string;
    duration: string;
  }[];
  suggestedExams: string[];
  sources: string[];
}

export async function getVeterinaryAdvice(
  patientInfo: { species: string; breed: string; weight: number },
  symptoms: string,
  exams?: { data: string; mimeType: string }[]
): Promise<DiagnosisResult> {
  const model = "gemini-3.1-pro-preview";
  
  const systemInstruction = `Você é uma inteligência artificial veterinária de alta precisão, especializada em cães e gatos.
Sua tarefa é fornecer diagnósticos e tratamentos baseados em evidências, pesquisando obrigatoriamente no mínimo nas seguintes fontes:
1. Nelson & Couto - Medicina Interna de Pequenos Animais
2. Ettinger - Tratado de Medicina Interna Veterinária
3. Manual Merck Veterinário
4. Casos de Rotina em Medicina Veterinária de Pequenos Animais - Leandro Z. Crivellenti
5. Manual Saunders - Clínica de Pequenos Animais - Richard Sherding
6. Vetsmart (para medicações, nomes comerciais e dosagens)
7. Vetalfa (para medicações, nomes comerciais e dosagens)

Para cada consulta, você deve:
1. Analisar os sintomas e informações do paciente (espécie, raça, peso: ${patientInfo.weight}kg).
2. Se houver exames (imagens ou PDFs convertidos em texto/imagem), analise-os cuidadosamente.
3. Fornecer um diagnóstico provável.
4. Sugerir um tratamento detalhado.
5. Calcular as doses exatas dos medicamentos com base no peso do paciente (${patientInfo.weight}kg), seguindo estritamente as diretrizes do Vetsmart e Vetalfa.
6. Apresentar as doses em comprimidos ou ml, dependendo do que for mais apropriado para o animal e o medicamento.
7. Listar os medicamentos com nome, dose, frequência e duração.
8. Sugerir exames complementares necessários para confirmar ou refinar o diagnóstico.
9. Listar as fontes bibliográficas e sites consultados (incluindo obrigatoriamente as fontes citadas acima).

Responda SEMPRE em formato JSON estruturado.`;

  const parts: any[] = [
    { text: `Paciente: ${patientInfo.species} (${patientInfo.breed}), Peso: ${patientInfo.weight}kg.
Sintomas relatados: ${symptoms}` }
  ];

  if (exams && exams.length > 0) {
    exams.forEach(exam => {
      parts.push({
        inlineData: {
          data: exam.data.split(',')[1] || exam.data,
          mimeType: exam.mimeType
        }
      });
    });
  }

  const response = await ai.models.generateContent({
    model,
    contents: { parts },
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          diagnosis: { type: Type.STRING },
          treatment: { type: Type.STRING },
          medications: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                dosage: { type: Type.STRING },
                frequency: { type: Type.STRING },
                duration: { type: Type.STRING }
              },
              required: ["name", "dosage", "frequency", "duration"]
            }
          },
          suggestedExams: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          sources: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["diagnosis", "treatment", "medications", "suggestedExams", "sources"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  const model = "gemini-3-flash-preview";
  
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        parts: [
          {
            inlineData: {
              data: audioBase64,
              mimeType: mimeType
            }
          },
          {
            text: "Transcreva este áudio veterinário com precisão. Retorne apenas o texto da transcrição, sem comentários adicionais."
          }
        ]
      }
    ]
  });

  return response.text || "";
}
