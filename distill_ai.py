import os
import json
import re
from openai import OpenAI

# 1. Kết nối với LM Studio đang chạy trên máy bạn
client = OpenAI(base_url="http://localhost:1234/v1", api_key="not-needed")

# 2. System Prompt (Khuôn đúc JSON)
system_prompt = """Bạn là một chuyên gia y tế cấp cứu và cứu hộ thảm họa người Việt Nam. Nhiệm vụ của bạn là phân tích các tình huống khẩn cấp, sau đó chưng cất kiến thức thành một bộ hướng dẫn sơ cứu nhanh gọn.
TUYỆT ĐỐI KHÔNG giải thích. CHỈ XUẤT RA JSON hợp lệ theo đúng schema sau:
{
  "id": "slug-tinh-huong-tieng-viet-khong-dau",
  "title": "Tên tình huống / Hành động cần làm",
  "category": "emergency",
  "timeframe": "0-1h",
  "urgency": "critical | high | medium | low",
  "summary": "Tóm tắt 1 câu",
  "keywords": ["từ khóa"],
  "reasoning_trace": "Luồng suy luận",
  "references": ["Bộ Y tế Việt Nam"],
  "steps": [{"title": "Tên bước", "body": "Nội dung", "warning": "", "image": "placeholder.svg"}]
}"""

# 3. Danh sách các tình huống (Bạn có thể thêm hàng trăm dòng vào đây)
scenarios = [
    "Bị đỉa/vắt cắn máu chảy không ngừng khi đi rừng.",
    "Đạp phải đinh gỉ sét trong nước lũ.",
    "Nạn nhân bị điện giật do cột điện đổ xuống nước."
]

# Đảm bảo thư mục lưu file đã tồn tại
output_dir = "data/articles"
os.makedirs(output_dir, exist_ok=True)

print("🚀 Bắt đầu quá trình chưng cất AI...")

# 4. Vòng lặp chạy tự động
for scenario in scenarios:
    print(f"\nĐang xử lý: {scenario}")
    try:
        response = client.chat.completions.create(
            model="gemma-4-e4b-it:2", # Tên model không quan trọng với LM Studio
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": scenario}
            ],
            temperature=0.1, # Nhiệt độ thấp để AI trả về JSON chuẩn xác, ít sáng tạo linh tinh
        )
        
        output_text = response.choices[0].message.content
        
        # Lọc lấy khối JSON từ phản hồi của AI
        json_match = re.search(r'\{.*\}', output_text, re.DOTALL)
        if json_match:
            json_str = json_match.group(0)
            data = json.loads(json_str)
            
            # Lấy ID làm tên file
            filename = f"{data['id']}.json"
            filepath = os.path.join(output_dir, filename)
            
            # Lưu file
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"✅ Đã lưu thành công: {filepath}")
        else:
            print(f"❌ Không tìm thấy JSON hợp lệ cho: {scenario}")
            
    except Exception as e:
        print(f"❌ Lỗi khi xử lý '{scenario}': {e}")

print("\n🎉 Hoàn thành chưng cất!")