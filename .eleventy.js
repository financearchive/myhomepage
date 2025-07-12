const slugify = require("@sindresorhus/slugify");
const markdownIt = require("markdown-it");
const fs = require("fs");
const matter = require("gray-matter");
const faviconsPlugin = require("eleventy-plugin-gen-favicons");
const tocPlugin = require("eleventy-plugin-nesting-toc");
const { parse } = require("node-html-parser");
const htmlMinifier = require("html-minifier-terser");
const pluginRss = require("@11ty/eleventy-plugin-rss");
const Image = require("@11ty/eleventy-img");

const { headerToId, namedHeadingsFilter } = require("./src/helpers/utils");
const { userMarkdownSetup, userEleventySetup } = require("./src/helpers/userSetup");

// 🚀 성능 최적화: 설정 상수화
const CONFIG = {
  IMAGE: {
    widths: ["500", "700", "auto"],
    formats: ["webp", "jpeg"],
    outputDir: "./dist/img/optimized",
    urlPath: "/img/optimized"
  },
  CACHE: {
    maxSize: 1000, // 메모리 제한
    ttl: 3600000   // 1시간 TTL
  },
  MINIFIER: {
    useShortDoctype: true,
    removeComments: true,
    collapseWhitespace: true,
    conservativeCollapse: true,
    preserveLineBreaks: true,
    minifyCSS: true,
    minifyJS: true,
    keepClosingSlash: true
  }
};

// 🚀 스마트 캐싱: LRU 캐시 구현
class SmartCache {
  constructor(maxSize = CONFIG.CACHE.maxSize) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.stats = new Map();
  }

  get(key) {
    if (this.cache.has(key)) {
      const value = this.cache.get(key);
      // LRU: 재배치
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return null;
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      // 가장 오래된 항목 제거
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    this.cache.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.stats.get('hits') / (this.stats.get('hits') + this.stats.get('misses')) || 0
    };
  }
}

// 🚀 개선된 파일 캐시
const fileCache = new SmartCache();
const imageCache = new SmartCache();

// 🚀 최적화: 정규표현식 사전 컴파일
const REGEX = {
  tag: /(^|\s|\>)(#[^\s!@#$%^&*()=+\.,\[{\]};:'"?><]+)(?!([^<]*>))/g,
  wikiLink: /\[\[(.*?\|.*?)\]\]/g,
  dataview: /\(\S+\:\:(.*)\)/g,
  callout: /\[!([\w-]*)\|?(\s?.*)\](\+|\-){0,1}(\s?.*)/
};

// 🚀 성능 개선: 파일 변경 감지 포함
function getFrontMatter(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const cacheKey = `${filePath}:${stat.mtime.getTime()}`;
    
    if (fileCache.has(cacheKey)) {
      return fileCache.get(cacheKey);
    }

    const file = fs.readFileSync(filePath, "utf8");
    const frontMatter = matter(file);
    fileCache.set(cacheKey, frontMatter);
    return frontMatter;
  } catch (error) {
    console.warn(`[Eleventy] 파일 읽기 실패: ${filePath}`, error.message);
    return null;
  }
}

// 🚀 이미지 최적화: 조건부 처리
function transformImage(src, cls, alt, sizes, widths = CONFIG.IMAGE.widths) {
  const cacheKey = `${src}:${widths.join(',')}`;
  
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey);
  }

  const options = {
    ...CONFIG.IMAGE,
    widths: widths
  };

  try {
    // 프로덕션에서만 이미지 변환
    if (process.env.ELEVENTY_ENV === "prod") {
      Image(src, options);
    }
    
    const metadata = Image.statsSync(src, options);
    imageCache.set(cacheKey, metadata);
    return metadata;
  } catch (error) {
    console.warn(`[Eleventy] 이미지 변환 실패: ${src}`, error.message);
    return null;
  }
}

// 🚀 성능 개선: 앵커 속성 생성 최적화
function getAnchorAttributes(filePath, linkTitle) {
  const fileName = filePath.replaceAll("&", "&");
  const [actualFileName, header] = fileName.includes("#") ? fileName.split("#") : [fileName, ""];
  const headerLinkPath = header ? `#${headerToId(header)}` : "";
  
  const noteIcon = process.env.NOTE_ICON_DEFAULT || "";
  const title = linkTitle || fileName;
  let permalink = `/notes/${slugify(filePath)}`;
  
  try {
    const startPath = "./src/site/notes/";
    const fullPath = actualFileName.endsWith(".md") 
      ? `${startPath}${actualFileName}`
      : `${startPath}${actualFileName}.md`;
    
    const frontMatter = getFrontMatter(fullPath);
    
    if (frontMatter) {
      if (frontMatter.data.permalink) {
        permalink = frontMatter.data.permalink;
      }
      if (frontMatter.data.tags?.includes("gardenEntry")) {
        permalink = "/";
      }
    }
    
    return {
      attributes: {
        class: "internal-link",
        target: "",
        "data-note-icon": frontMatter?.data.noteIcon || noteIcon,
        href: `${permalink}${headerLinkPath}`
      },
      innerHTML: title
    };
  } catch (error) {
    console.warn(`[Eleventy] 링크 처리 실패: ${filePath}`, error.message);
    return {
      attributes: {
        class: "internal-link is-unresolved",
        href: "/404",
        target: ""
      },
      innerHTML: title
    };
  }
}

function getAnchorLink(filePath, linkTitle) {
  const { attributes, innerHTML } = getAnchorAttributes(filePath, linkTitle);
  return ` `${key}="${value}"`).join(" ")}>${innerHTML}`;
}

// 🚀 성능 개선: 조건부 HTML 파싱
function parseHtmlOnce(str) {
  if (!str || typeof str !== 'string') return null;
  
  try {
    return parse(str);
  } catch (error) {
    console.warn('[Eleventy] HTML 파싱 실패:', error.message);
    return null;
  }
}

// 🚀 메인 설정 함수
module.exports = function (eleventyConfig) {
  // 환경 변수 설정
  const isDev = process.env.ELEVENTY_ENV === "dev";
  const isProd = process.env.ELEVENTY_ENV === "prod";
  
  eleventyConfig.setLiquidOptions({
    dynamicPartials: true,
  });

  // 🚀 마크다운 설정 최적화
  const markdownLib = markdownIt({
    breaks: true,
    html: true,
    linkify: true,
  })
    .use(require("markdown-it-anchor"), { slugify: headerToId })
    .use(require("markdown-it-mark"))
    .use(require("markdown-it-footnote"))
    .use(require("markdown-it-mathjax3"), {
      tex: { inlineMath: [["$", "$"]] },
      options: { skipHtmlTags: { "[-]": ["pre"] } }
    })
    .use(require("markdown-it-attrs"))
    .use(require("markdown-it-task-checkbox"), {
      disabled: true,
      divWrap: false,
      divClass: "checkbox",
      idPrefix: "cbx_",
      ulClass: "task-list",
      liClass: "task-list-item"
    })
    .use(require("markdown-it-plantuml"), {
      openMarker: "```plantuml",
      closeMarker: "```"
    })
    .use(namedHeadingsFilter)
    .use(function (md) {
      // 커스텀 렌더러 설정
      const origFenceRule = md.renderer.rules.fence || function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options, env, self);
      };

      md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
        const token = tokens[idx];
        const info = token.info.trim();
        const code = token.content.trim();

        switch (info) {
          case "mermaid":
            return `
${code}
`;
          case "transclusion":
            return `
${md.render(code)}
`;
          default:
            if (info.startsWith("ad-")) {
              return renderCallout(info, code, md);
            }
            return origFenceRule(tokens, idx, options, env, slf);
        }
      };

      // 이미지 렌더러 최적화
      const defaultImageRule = md.renderer.rules.image || function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options, env, self);
      };

      md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const imageName = tokens[idx].content;
        const [fileName, ...metadata] = imageName.split("|");
        const lastValue = metadata[metadata.length - 1];
        const width = !isNaN(lastValue) ? lastValue : null;

        if (width) {
          const widthIndex = tokens[idx].attrIndex("width");
          const widthAttr = `${width}px`;
          if (widthIndex < 0) {
            tokens[idx].attrPush(["width", widthAttr]);
          } else {
            tokens[idx].attrs[widthIndex][1] = widthAttr;
          }
        }

        return defaultImageRule(tokens, idx, options, env, self);
      };

      // 외부 링크 처리 최적화
      const defaultLinkRule = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options, env, self);
      };

      md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
        const token = tokens[idx];
        const aIndex = token.attrIndex("target");
        const classIndex = token.attrIndex("class");

        if (aIndex < 0) {
          token.attrPush(["target", "_blank"]);
        } else {
          token.attrs[aIndex][1] = "_blank";
        }

        if (classIndex < 0) {
          token.attrPush(["class", "external-link"]);
        } else {
          token.attrs[classIndex][1] = "external-link";
        }

        return defaultLinkRule(tokens, idx, options, env, self);
      };
    })
    .use(userMarkdownSetup);

  eleventyConfig.setLibrary("md", markdownLib);

  // 🚀 필터 최적화
  eleventyConfig.addFilter("isoDate", date => date?.toISOString());
  
  eleventyConfig.addFilter("dateToZulu", function (date) {
    try {
      return new Date(date).toISOString();
    } catch {
      return "";
    }
  });

  eleventyConfig.addFilter("dateToRfc822", date => new Date(date).toUTCString());

  eleventyConfig.addFilter("getNewestCollectionItemDate", function(collection) {
    if (!collection?.length) return new Date();
    return new Date(Math.max(...collection.map(item => 
      item.date ? new Date(item.date).getTime() : 0
    )));
  });

  eleventyConfig.addFilter("link", function (str) {
    if (!str) return str;
    return str.replace(REGEX.wikiLink, function (match, p1) {
      if (p1.includes("],[") || p1.includes('"$"')) {
        return match;
      }
      const [fileLink, linkTitle] = p1.split("|");
      return getAnchorLink(fileLink, linkTitle);
    });
  });

  eleventyConfig.addFilter("taggify", function (str) {
    if (!str) return str;
    return str.replace(REGEX.tag, function (match, precede, tag) {
      return `${precede}${tag}`;
    });
  });

  eleventyConfig.addFilter("searchableTags", function (str) {
    if (!str) return "";
    const matches = str.match(REGEX.tag);
    if (!matches) return "";
    
    const tags = matches.map(m => `"${m.split("#")[1]}"`).join(", ");
    return tags ? `${tags},` : "";
  });

  eleventyConfig.addFilter("hideDataview", function (str) {
    if (!str) return str;
    return str.replace(REGEX.dataview, (_, value) => value.trim());
  });

  eleventyConfig.addFilter("jsonify", variable => JSON.stringify(variable) || '""');

  eleventyConfig.addFilter("validJson", function (variable) {
    if (Array.isArray(variable)) {
      return variable.map(x => x.replaceAll("\\", "\\\\")).join(",");
    }
    if (typeof variable === "string") {
      return variable.replaceAll("\\", "\\\\");
    }
    return variable;
  });

  // 🚀 변환 최적화
  eleventyConfig.addTransform("dataview-js-links", function (str) {
    if (!str) return str;
    
    const parsed = parseHtmlOnce(str);
    if (!parsed) return str;

    const links = parsed.querySelectorAll("a[data-href].internal-link");
    for (const link of links) {
      const notePath = link.getAttribute("data-href");
      const title = link.innerHTML;
      const { attributes, innerHTML } = getAnchorAttributes(notePath, title);
      
      Object.entries(attributes).forEach(([key, value]) => {
        link.setAttribute(key, value);
      });
      link.innerHTML = innerHTML;
    }

    return parsed.innerHTML;
  });

  // 🚀 조건부 이미지 최적화
  if (isProd) {
    eleventyConfig.addTransform("picture", function (str) {
      if (process.env.USE_FULL_RESOLUTION_IMAGES === "true" || !str) {
        return str;
      }
      
      const parsed = parseHtmlOnce(str);
      if (!parsed) return str;

      const images = parsed.querySelectorAll(".cm-s-obsidian img");
      for (const img of images) {
        const src = img.getAttribute("src");
        if (src?.startsWith("/") && !src.endsWith(".svg")) {
          try {
            const cls = img.classList.value;
            const alt = img.getAttribute("alt") || "";
            const width = img.getAttribute("width") || "";

            const meta = transformImage(
              "./src/site" + decodeURI(src),
              cls,
              alt,
              ["(max-width: 480px)", "(max-width: 1024px)"]
            );

            if (meta) {
              fillPictureSourceSets(src, cls, alt, meta, width, img);
            }
          } catch (error) {
            console.warn(`[Eleventy] 이미지 처리 실패: ${src}`, error.message);
          }
        }
      }

      return parsed.innerHTML;
    });
  }

  // 🚀 최적화된 HTML 압축
  eleventyConfig.addTransform("htmlMinifier", (content, outputPath) => {
    if (!isProd || !outputPath?.endsWith(".html")) return content;
    
    const excludePatterns = ["rss.xml", "sitemap.xml", "feed.xml"];
    if (excludePatterns.some(pattern => outputPath.includes(pattern))) {
      return content;
    }

    try {
      return htmlMinifier.minify(content, CONFIG.MINIFIER);
    } catch (error) {
      console.warn('[Eleventy] HTML 압축 실패:', error.message);
      return content;
    }
  });

  // 플러그인 설정
  eleventyConfig.addPlugin(faviconsPlugin, { outputDir: "dist" });
  eleventyConfig.addPlugin(tocPlugin, {
    ul: true,
    tags: ["h1", "h2", "h3", "h4", "h5", "h6"]
  });
  eleventyConfig.addPlugin(pluginRss, {
    posthtmlRenderOptions: {
      closingSingleTag: "slash",
      singleTags: ["link"]
    }
  });

  // 파일 복사
  eleventyConfig.addPassthroughCopy("src/site/img");
  eleventyConfig.addPassthroughCopy("src/site/scripts");
  eleventyConfig.addPassthroughCopy("src/site/styles/_theme.*.css");
  eleventyConfig.addPassthroughCopy("src/site/ads.txt");

  userEleventySetup(eleventyConfig);

  return {
    dir: {
      input: "src/site",
      output: "dist",
      data: "_data"
    },
    templateFormats: ["njk", "md", "11ty.js"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: false,
    passthroughFileCopy: true,
    cacheDir: ".eleventy-cache"
  };
};

// 🚀 헬퍼 함수들
function renderCallout(info, code, md) {
  const parts = code.split("\n");
  let titleLine = "";
  let collapse = "";
  let collapsible = false;
  let collapsed = true;
  let nbLinesToSkip = 0;

  for (let i = 0; i < 4; i++) {
    const line = parts[i]?.trim().toLowerCase();
    if (!line) continue;

    if (line.startsWith("title:")) {
      titleLine = line.substring(6);
      nbLinesToSkip++;
    } else if (line.startsWith("collapse:")) {
      collapsible = true;
      collapse = line.substring(9);
      if (collapse?.trim().toLowerCase() === 'open') {
        collapsed = false;
      }
      nbLinesToSkip++;
    }
  }

  const foldDiv = collapsible ? `

    
  
` : "";

  const titleDiv = titleLine ? `
${titleLine}
${foldDiv}
` : "";
  const collapseClasses = titleLine && collapsible ? (collapsed ? 'is-collapsible is-collapsed' : 'is-collapsible') : '';

  return `
${titleDiv}
${md.render(parts.slice(nbLinesToSkip).join("\n"))}
`;
}

function fillPictureSourceSets(src, cls, alt, meta, width, imageTag) {
  imageTag.tagName = "picture";
  let html = `
`;

  if (meta.webp?.[1]?.url) {
    html += ``;
  }
  if (meta.jpeg?.[1]?.url) {
    html += ``;
  }

  html += `${alt}`;
  imageTag.innerHTML = html;
}
