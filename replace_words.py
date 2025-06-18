import os
import glob
import re

# 수정할 문자열 쌍
replacements = {
    "![](": "![-](",
    "Pasted image ": "Pasted%20image%20"
}

folder_path = "."  # 저장소 루트
file_extension = "*.md"

# .md 파일 목록 가져오기
md_files = glob.glob(os.path.join(folder_path, "**", file_extension), recursive=True)

# 수정된 파일 추적
modified_files = []

# 각 파일 처리
for file_path in md_files:
    try:
        with open(file_path, "r", encoding="utf-8") as file:
            content = file.read()

        # 문자열 변경
        new_content = content
        for old_str, new_str in replacements.items():
            # 대소문자 무시 정규식
            pattern = re.compile(re.escape(old_str), re.IGNORECASE)
            if pattern.search(new_content):
                new_content = pattern.sub(new_str, new_content)
                if file_path not in modified_files:
                    modified_files.append(file_path)

        # 변경 사항이 있으면 파일 쓰기
        if new_content != content:
            with open(file_path, "w", encoding="utf-8") as file:
                file.write(new_content)
            print(f"수정됨: {file_path}")
        else:
            print(f"변경 없음: {file_path}")
    except Exception as e:
        print(f"오류 발생 ({file_path}): {e}")

# 결과 출력
if modified_files:
    print("\n수정된 파일 목록:")
    for f in modified_files:
        print(f"- {f}")
else:
    print("\n수정된 파일 없음")
print("처리 완료!")