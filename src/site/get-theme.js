require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");
const { globSync } = require("glob");

const themeCommentRegex = /\/\*[\s\S]*?\*\//g;

async function getTheme() {
  let themeUrl = process.env.THEME;
  if (!themeUrl) return;

  // theme.css ↔ obsidian.css 토글
  try {
    await axios.get(themeUrl);
  } catch {
    if (themeUrl.includes("theme.css")) {
      themeUrl = themeUrl.replace("theme.css", "obsidian.css");
    } else if (themeUrl.includes("obsidian.css")) {
      themeUrl = themeUrl.replace("obsidian.css", "theme.css");
    }
  }

  const res = await axios.get(themeUrl);
  // 이전에 생성된 파일들 삭제
  globSync("src/site/styles/_theme.*.css").forEach((f) => fs.rmSync(f));

  // 첫 번째 CSS 주석만 남기고 나머지 전부 제거
  let skipped = false;
  const data = res.data.replace(themeCommentRegex, (m) => {
    if (skipped) return "";
    skipped = true;
    return m;
  });

  // SHA256 해시로 파일명 생성
  const hash = crypto.createHash("sha256").update(data).digest("hex").substring(0, 8);
  fs.writeFileSync(`src/site/styles/_theme.${hash}.css`, data);
  // **고정 파일명**으로도 복사
  fs.writeFileSync(`src/site/styles/_theme.css`, data);
}

getTheme();

