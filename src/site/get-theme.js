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
  // 이전에 생성된 모든 _theme.*.css 파일 삭제
  globSync("src/site/styles/_theme.*.css").forEach((file) => {
    try { fs.rmSync(file); } catch {}
  });

  // 첫 번째 CSS 주석만 남기고 나머지 삭제
  let skippedFirst = false;
  const data = res.data.replace(themeCommentRegex, (match) => {
    if (skippedFirst) return "";
    skippedFirst = true;
    return match;
  });

  // SHA256 해시로 파일명 생성
  const hash = crypto.createHash("sha256").update(data).digest("hex").substring(0, 8);
  // 해시 버전
  fs.writeFileSync(`src/site/styles/_theme.${hash}.css`, data);
  // 고정된 이름 버전 (_theme.css)
  fs.writeFileSync(`src/site/styles/_theme.css`, data);
}

getTheme();
