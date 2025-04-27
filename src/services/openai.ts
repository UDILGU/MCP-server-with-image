export async function analyzeImageWithOpenAIVision(imageUrl: string, openaiApiKey: string): Promise<string> {
  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const body = {
    model: "gpt-4-vision-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this image. Focus on UI/UX, text, buttons, and visual elements." },
          { type: "image_url", image_url: { url: imageUrl } }
        ]
      }
    ],
    max_tokens: 512
  };

  // 디버깅: image_url 로그 출력
  console.log("[Vision API] image_url:", imageUrl);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    // 디버깅: 에러 메시지 전체 출력
    console.error("[Vision API] error:", errorText);
    throw new Error("OpenAI Vision API call failed: " + errorText);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
} 