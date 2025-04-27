export async function analyzeImageWithOpenAIVision(imageUrl: string, openaiApiKey: string): Promise<string> {
  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const body = {
    model: "gpt-4-vision-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } }
          { type: "text", text: "Describe this image. Focus on UI/UX, text, buttons, and visual elements." },
        ]
      }
    ],
    max_tokens: 512
  };
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("OpenAI Vision API call failed");
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
} 