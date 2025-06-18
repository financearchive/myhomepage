warning: in the working copy of 'replace_words.py', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/replace_words.py b/replace_words.py[m
[1mindex 8bf8078..3f9fee8 100644[m
[1m--- a/replace_words.py[m
[1m+++ b/replace_words.py[m
[36m@@ -1,13 +1,14 @@[m
 import os[m
 import glob[m
[32m+[m[32mimport re[m
 [m
[31m-# 수정할 문자열 쌍 (키: 원래 문자열, 값: 새 문자열)[m
[32m+[m[32m# 수정할 문자열 쌍[m
 replacements = {[m
     "![](": "![-](",[m
     "Pasted image ": "Pasted%20image%20"[m
 }[m
 [m
[31m-folder_path = "."  # 현재 폴더 (저장소 루트)[m
[32m+[m[32mfolder_path = "."  # 저장소 루트[m
 file_extension = "*.md"[m
 [m
 # .md 파일 목록 가져오기[m
[36m@@ -25,9 +26,10 @@[m [mfor file_path in md_files:[m
         # 문자열 변경[m
         new_content = content[m
         for old_str, new_str in replacements.items():[m
[31m-            # 직접 문자열 치환[m
[31m-            if old_str in new_content:[m
[31m-                new_content = new_content.replace(old_str, new_str)[m
[32m+[m[32m            # 대소문자 무시 정규식[m
[32m+[m[32m            pattern = re.compile(re.escape(old_str), re.IGNORECASE)[m
[32m+[m[32m            if pattern.search(new_content):[m
[32m+[m[32m                new_content = pattern.sub(new_str, new_content)[m
                 if file_path not in modified_files:[m
                     modified_files.append(file_path)[m
 [m
