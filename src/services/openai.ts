export async function analyzeImageWithOpenAIVision(imageUrl: string, openaiApiKey: string): Promise<string> {
  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const prompt = `
이미지를 보고 아래 중 하나로 분류해서 답변하세요.

1. 만약 UI 컴포넌트(버튼, 입력창, 체크박스, 토글, 카드, 탭, 드롭다운, 스탭퍼, 피커 등)로 추정된다면, 해당 UI 컴포넌트의 이름을 한글로 명확히 기재하세요. (예: 버튼, 입력창, 카드, 스탭퍼 등)
2. UI 컴포넌트가 아니지만 아이콘으로 인식된다면, 어떤 의미의 아이콘인지 한 줄로 요약해서 한글로 설명하세요.
3. 1, 2가 아니지만 의미가 있는 이미지(예: 일러스트, 사진 등)라면, 그 내용을 한 줄로 요약해서 한글로 설명하세요.
4. UI 컴포넌트도 아니고 의미가 있는 이미지도 아니라면(예: 단순 배경, 장식, 패턴 등), "분석결과 없음"이라고 답변하세요.

반드시 위 3가지 중 하나로만 답변하세요.
  `;
  const body = {
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl } }
        ]
      }
    ],
    max_tokens: 256
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
  return data.choices?.[0]?.message?.content?.trim() || "";
} 