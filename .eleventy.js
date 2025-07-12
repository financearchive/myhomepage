const slugify = require("@sindresorhus/slugify");
const markdownIt = require("markdown-it");
const fs = require("fs");
const matter = require("gray-matter");
const faviconsPlugin = require("eleventy-plugin-gen-favicons");
const tocPlugin = require("eleventy-plugin-nesting-toc");
const { parse } = require("node-html-parser");
const htmlMinifier = require("html-minifier-terser");
const pluginRss = require("@11ty/eleventy-plugin-rss");
const { headerToId, namedHeadingsFilter } = require("./src/helpers/utils");
const { userMarkdownSetup, userEleventySetup } = require("./src/helpers/userSetup");
const Image = require("@11ty/eleventy-img");

// 최적화: 설정 상수화
const IMAGE_CONFIG = {
  widths: ["500", "700", "auto"],
  formats: ["webp", "jpeg"],
  outputDir: "./dist/img/optimized",
  urlPath: "/img/optimized"
};

const MINIFIER_CONFIG = {
  useShortDoctype: true,
  removeComments: true,
  collapseWhitespace: true,
  conservativeCollapse: true,
  preserveLineBreaks: true,
  minifyCSS: true,
  minifyJS: true,
  keepClosingSlash: true
};

// 최적화: 캐시 크기 제한
const fileCache = new Map();
const MAX_CACHE_SIZE = 1000;

// 최적화: 정규표현식 상수화
const tagRegex = /(^|\s|\>)(#[^\s!@#$%^&*()=+\.,\[{\]};:'"?><]+)(?!([^<]*>))/g;
const calloutMetaRegex = /\[!([\w-]*)\|?(\s?.*)\](\+|\-){0,1}(\s?.*)/;

// 최적화: 캐시 정리 함수
function cleanupCache() {
  if (fileCache.size > MAX_CACHE_SIZE) {
    const keys = Array.from(fileCache.keys());
    const deleteCount = Math.floor(MAX_CACHE_SIZE * 0.2);
    for (let i = 0; i < deleteCount; i++) {
      fileCache.delete(keys[i]);
    }
  }
}

function getFrontMatter(filePath) {
  if (fileCache.has(filePath)) {
    return fileCache.get(filePath);
  }
  
  try {
    const file = fs.readFileSync(filePath, "utf8");
    const frontMatter = matter(file);
    fileCache.set(filePath, frontMatter);
    
    // 최적화: 주기적 캐시 정리
    if (fileCache.size % 100 === 0) {
      cleanupCache();
    }
    
    return frontMatter;
  } catch (error) {
    console.warn(`Failed to read frontmatter for ${filePath}:`, error.message);
    return null;
  }
}

function transformImage(src, cls, alt, sizes, widths = IMAGE_CONFIG.widths) {
  const options = {
    widths: widths,
    formats: IMAGE_CONFIG.formats,
    outputDir: IMAGE_CONFIG.outputDir,
    urlPath: IMAGE_CONFIG.urlPath,
  };

  // 최적화: 프로덕션에서만 이미지 생성
  if (process.env.ELEVENTY_ENV === "prod") {
    Image(src, options);
  }
  
  let metadata;
  try {
    metadata = Image.statsSync(src, options);
  } catch (error) {
    console.warn(`Failed to process image ${src}:`, error.message);
    return null;
  }
  
  return metadata;
}

function getAnchorLink(filePath, linkTitle) {
  const {attributes, innerHTML} = getAnchorAttributes(filePath, linkTitle);
  return `<a ${Object.keys(attributes).map(key => `${key}="${attributes[key]}"`).join(" ")}>${innerHTML}</a>`;
}

function getAnchorAttributes(filePath, linkTitle) {
  let fileName = filePath.replaceAll("&amp;", "&");
  let header = "";
  let headerLinkPath = "";
  
  if (filePath.includes("#")) {
    [fileName, header] = filePath.split("#");
    headerLinkPath = `#${headerToId(header)}`;
  }

  let noteIcon = process.env.NOTE_ICON_DEFAULT;
  const title = linkTitle || fileName;
  let permalink = `/notes/${slugify(filePath)}`;
  let deadLink = false;
  
  try {
    const startPath = "./src/site/notes/";
    const fullPath = fileName.endsWith(".md") 
      ? `${startPath}${fileName}` 
      : `${startPath}${fileName}.md`;
    
    const frontMatter = getFrontMatter(fullPath);
    
    if (frontMatter?.data?.permalink) {
      permalink = frontMatter.data.permalink;
    }
    
    if (frontMatter?.data?.tags?.indexOf("gardenEntry") !== -1) {
      permalink = "/";
    }
    
    if (frontMatter?.data?.noteIcon) {
      noteIcon = frontMatter.data.noteIcon;
    }
  } catch (error) {
    console.warn(`Failed to process anchor for ${filePath}:`, error.message);
    deadLink = true;
  }

  if (deadLink) {
    return {
      attributes: {
        "class": "internal-link is-unresolved",
        "href": "/404",
        "target": "",
      },
      innerHTML: title,
    };
  }
  
  return {
    attributes: {
      "class": "internal-link",
      "target": "",
      "data-note-icon": noteIcon,
      "href": `${permalink}${headerLinkPath}`,
    },
    innerHTML: title,
  };
}

module.exports = function (eleventyConfig) {
  eleventyConfig.setLiquidOptions({
    dynamicPartials: true,
  });

  let markdownLib = markdownIt({
    breaks: true,
    html: true,
    linkify: true,
  })
    .use(require("markdown-it-anchor"), {
      slugify: headerToId,
    })
    .use(require("markdown-it-mark"))
    .use(require("markdown-it-footnote"))
    .use(function (md) {
      md.renderer.rules.hashtag_open = function (tokens, idx) {
        return '<a class="tag" onclick="toggleTagSearch(this)">';
      };
    })
    .use(require("markdown-it-mathjax3"), {
      tex: {
        inlineMath: [["$", "$"]],
      },
      options: {
        skipHtmlTags: { "[-]": ["pre"] },
      },
    })
    .use(require("markdown-it-attrs"))
    .use(require("markdown-it-task-checkbox"), {
      disabled: true,
      divWrap: false,
      divClass: "checkbox",
      idPrefix: "cbx_",
      ulClass: "task-list",
      liClass: "task-list-item",
    })
    .use(require("markdown-it-plantuml"), {
      openMarker: "```plantuml",
      closeMarker: "```",
    })
    .use(namedHeadingsFilter)
    .use(function (md) {
      const origFenceRule = md.renderer.rules.fence || function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options, env, self);
      };
      
      md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
        const token = tokens[idx];
        
        if (token.info === "mermaid") {
          const code = token.content.trim();
          return `<pre class="mermaid">${code}</pre>`;
        }
        
        if (token.info === "transclusion") {
          const code = token.content.trim();
          return `<div class="transclusion">${md.render(code)}</div>`;
        }
        
        if (token.info.startsWith("ad-")) {
          const code = token.content.trim();
          const parts = code.split("\n");
          let titleLine = "";
          let collapsible = false;
          let collapsed = true;
          let nbLinesToSkip = 0;
          
          for (let i = 0; i < 4; i++) {
            if (parts[i]?.trim()) {
              const line = parts[i].trim().toLowerCase();
              if (line.startsWith("title:")) {
                titleLine = line.substring(6);
                nbLinesToSkip++;
              } else if (line.startsWith("collapse:")) {
                collapsible = true;
                const collapse = line.substring(9);
                if (collapse?.trim().toLowerCase() === 'open') {
                  collapsed = false;
                }
                nbLinesToSkip++;
              }
            }
          }
          
          const foldDiv = collapsible ? `<div class="callout-fold">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-down">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>` : "";
          
          const titleDiv = titleLine ? `<div class="callout-title"><div class="callout-title-inner">${titleLine}</div>${foldDiv}</div>` : "";
          let collapseClasses = titleLine && collapsible ? 'is-collapsible' : '';
          if (collapsible && collapsed) {
            collapseClasses += " is-collapsed";
          }

          return `<div data-callout-metadata class="callout ${collapseClasses}" data-callout="${token.info.substring(3)}">${titleDiv}
<div class="callout-content">${md.render(parts.slice(nbLinesToSkip).join("\n"))}</div></div>`;
        }

        return origFenceRule(tokens, idx, options, env, slf);
      };

      const defaultImageRule = md.renderer.rules.image || function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options, env, self);
      };
      
      md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const imageName = tokens[idx].content;
        const [fileName, ...widthAndMetaData] = imageName.split("|");
        const lastValue = widthAndMetaData[widthAndMetaData.length - 1];
        const lastValueIsNumber = !isNaN(lastValue);
        const width = lastValueIsNumber ? lastValue : null;

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

      const defaultLinkRule = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options, env, self);
      };
      
      md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
        const aIndex = tokens[idx].attrIndex("target");
        const classIndex = tokens[idx].attrIndex("class");

        if (aIndex < 0) {
          tokens[idx].attrPush(["target", "_blank"]);
        } else {
          tokens[idx].attrs[aIndex][1] = "_blank";
        }

        if (classIndex < 0) {
          tokens[idx].attrPush(["class", "external-link"]);
        } else {
          tokens[idx].attrs[classIndex][1] = "external-link";
        }

        return defaultLinkRule(tokens, idx, options, env, self);
      };
    })
    .use(userMarkdownSetup);

  eleventyConfig.setLibrary("md", markdownLib);

  // 최적화: 날짜 필터들
  eleventyConfig.addFilter("isoDate", function (date) {
    return date?.toISOString() || "";
  });

  eleventyConfig.addFilter("dateToZulu", function (date) {
    try {
      return new Date(date).toISOString();
    } catch (error) {
      console.warn("Invalid date:", date);
      return "";
    }
  });

  eleventyConfig.addFilter("dateToRfc822", function(date) {
    try {
      return new Date(date).toUTCString();
    } catch (error) {
      console.warn("Invalid date for RFC822:", date);
      return "";
    }
  });

  eleventyConfig.addFilter("getNewestCollectionItemDate", function(collection) {
    if (!collection?.length) {
      return new Date();
    }
    return new Date(Math.max(...collection.map(item => {
      return item.date ? new Date(item.date).getTime() : 0;
    })));
  });

  // 컨텐츠 필터들
  eleventyConfig.addFilter("link", function (str) {
    if (!str) return str;
    
    return str.replace(/\[\[(.*?\|.*?)\]\]/g, function (match, p1) {
      if (p1.indexOf("],[") > -1 || p1.indexOf('"$"') > -1) {
        return match;
      }
      const [fileLink, linkTitle] = p1.split("|");
      return getAnchorLink(fileLink, linkTitle);
    });
  });

  eleventyConfig.addFilter("taggify", function (str) {
    if (!str) return str;
    
    return str.replace(tagRegex, function (match, precede, tag) {
      return `${precede}<a class="tag" onclick="toggleTagSearch(this)" data-content="${tag}">${tag}</a>`;
    });
  });

  eleventyConfig.addFilter("searchableTags", function (str) {
    if (!str) return "";
    
    const match = str.match(tagRegex);
    if (match) {
      const tags = match.map(m => `"${m.split("#")[1]}"`).join(", ");
      return `${tags},`;
    }
    return "";
  });

  eleventyConfig.addFilter("hideDataview", function (str) {
    if (!str) return str;
    
    return str.replace(/\(\S+\:\:(.*)\)/g, function (_, value) {
      return value.trim();
    });
  });

  eleventyConfig.addFilter("jsonify", function (variable) {
    return JSON.stringify(variable) || '""';
  });

  eleventyConfig.addFilter("validJson", function (variable) {
    if (Array.isArray(variable)) {
      return variable.map(x => x.replaceAll("\\", "\\\\")).join(",");
    } else if (typeof variable === "string") {
      return variable.replaceAll("\\", "\\\\");
    }
    return variable;
  });

  // 변환 함수들
  eleventyConfig.addTransform("dataview-js-links", function (str) {
    if (!str) return str;
    
    const parsed = parse(str);
    const dataViewJsLinks = parsed.querySelectorAll("a[data-href].internal-link");
    
    for (const dataViewJsLink of dataViewJsLinks) {
      const notePath = dataViewJsLink.getAttribute("data-href");
      const title = dataViewJsLink.innerHTML;
      const {attributes, innerHTML} = getAnchorAttributes(notePath, title);
      
      for (const key in attributes) {
        dataViewJsLink.setAttribute(key, attributes[key]);
      }
      dataViewJsLink.innerHTML = innerHTML;
    }

    return parsed.innerHTML;
  });

  eleventyConfig.addTransform("callout-block", function (str) {
    if (!str) return str;
    
    const parsed = parse(str);
    const transformCalloutBlocks = (blockquotes = parsed.querySelectorAll("blockquote")) => {
      for (const blockquote of blockquotes) {
        transformCalloutBlocks(blockquote.querySelectorAll("blockquote"));

        let content = blockquote.innerHTML;
        if (!content.match(calloutMetaRegex)) {
          continue;
        }

        let titleDiv = "";
        let calloutType = "";
        let calloutMetaData = "";
        let isCollapsable = false;
        let isCollapsed = false;

        content = content.replace(calloutMetaRegex, function (metaInfoMatch, callout, metaData, collapse, title) {
          isCollapsable = Boolean(collapse);
          isCollapsed = collapse === "-";
          const titleText = title.replace(/(<\/{0,1}\w+>)/, "") ? title : `${callout.charAt(0).toUpperCase()}${callout.substring(1).toLowerCase()}`;
          const fold = isCollapsable ? `<div class="callout-fold"><i icon-name="chevron-down"></i></div>` : "";

          calloutType = callout;
          calloutMetaData = metaData;
          titleDiv = `<div class="callout-title"><div class="callout-title-inner">${titleText}</div>${fold}</div>`;
          return "";
        });

        if (content === "\n<p>\n") {
          content = "";
        }
        
        const contentDiv = content ? `\n<div class="callout-content">${content}</div>` : "";

        blockquote.tagName = "div";
        blockquote.classList.add("callout");
        blockquote.classList.add(isCollapsable ? "is-collapsible" : "");
        blockquote.classList.add(isCollapsed ? "is-collapsed" : "");
        blockquote.setAttribute("data-callout", calloutType.toLowerCase());
        if (calloutMetaData) {
          blockquote.setAttribute("data-callout-metadata", calloutMetaData);
        }
        blockquote.innerHTML = `${titleDiv}${contentDiv}`;
      }
    };

    transformCalloutBlocks();
    return parsed.innerHTML;
  });

  function fillPictureSourceSets(src, cls, alt, meta, width, imageTag) {
    imageTag.tagName = "picture";
    let html = `<source media="(max-width:480px)" srcset="${meta.webp[0].url}" type="image/webp" />
<source media="(max-width:480px)" srcset="${meta.jpeg[0].url}" />`;
    
    if (meta.webp?.[1]?.url) {
      html += `<source media="(max-width:1920px)" srcset="${meta.webp[1].url}" type="image/webp" />`;
    }
    if (meta.jpeg?.[1]?.url) {
      html += `<source media="(max-width:1920px)" srcset="${meta.jpeg[1].url}" />`;
    }
    
    html += `<img class="${cls.toString()}" src="${src}" alt="${alt}" width="${width}" />`;
    imageTag.innerHTML = html;
  }

  // 최적화: 이미지 변환 조건부 실행
  eleventyConfig.addTransform("picture", function (str) {
    if (process.env.USE_FULL_RESOLUTION_IMAGES === "true" || !str) {
      return str;
    }
    
    const parsed = parse(str);
    const imageElements = parsed.querySelectorAll(".cm-s-obsidian img");
    
    for (const imageTag of imageElements) {
      const src = imageTag.getAttribute("src");
      if (src?.startsWith("/") && !src.endsWith(".svg")) {
        const cls = imageTag.classList.value;
        const alt = imageTag.getAttribute("alt");
        const width = imageTag.getAttribute("width") || '';

        try {
          const meta = transformImage(
            "./src/site" + decodeURI(src),
            cls.toString(),
            alt,
            ["(max-width: 480px)", "(max-width: 1024px)"]
          );

          if (meta) {
            fillPictureSourceSets(src, cls, alt, meta, width, imageTag);
          }
        } catch (error) {
          console.warn(`Failed to transform image ${src}:`, error.message);
        }
      }
    }
    
    return parsed.innerHTML;
  });

  eleventyConfig.addTransform("table", function (str) {
    if (!str) return str;
    
    const parsed = parse(str);
    
    // 일반 테이블 처리
    const tables = parsed.querySelectorAll(".cm-s-obsidian > table");
    for (const table of tables) {
      const inner = table.innerHTML;
      table.tagName = "div";
      table.classList.add("table-wrapper");
      table.innerHTML = `<table>${inner}</table>`;
    }

    // 데이터뷰 테이블 처리
    const dataViewTables = parsed.querySelectorAll(".cm-s-obsidian > .block-language-dataview > table");
    for (const table of dataViewTables) {
      table.classList.add("dataview", "table-view-table");
      table.querySelector("thead")?.classList.add("table-view-thead");
      table.querySelector("tbody")?.classList.add("table-view-tbody");
      table.querySelectorAll("thead > tr")?.forEach(tr => tr.classList.add("table-view-tr-header"));
      table.querySelectorAll("thead > tr > th")?.forEach(th => th.classList.add("table-view-th"));
    }
    
    return parsed.innerHTML;
  });

  // 최적화: HTML 압축 조건부 실행
  eleventyConfig.addTransform("htmlMinifier", (content, outputPath) => {
    const isProduction = process.env.NODE_ENV === "production" || process.env.ELEVENTY_ENV === "prod";
    const isHtmlFile = outputPath?.endsWith(".html");
    const isNotXmlFile = !outputPath?.includes("rss.xml") && !outputPath?.includes("sitemap.xml") && !outputPath?.includes("feed.xml");
    
    if (isProduction && isHtmlFile && isNotXmlFile) {
      try {
        return htmlMinifier.minify(content, MINIFIER_CONFIG);
      } catch (error) {
        console.warn(`Failed to minify ${outputPath}:`, error.message);
        return content;
      }
    }
    return content;
  });

  // 정적 파일 복사
  eleventyConfig.addPassthroughCopy("src/site/img");
  eleventyConfig.addPassthroughCopy("src/site/scripts");
  eleventyConfig.addPassthroughCopy("src/site/styles/_theme.*.css");
  eleventyConfig.addPassthroughCopy("src/site/ads.txt");

  // 플러그인 설정
  eleventyConfig.addPlugin(faviconsPlugin, { outputDir: "dist" });
  eleventyConfig.addPlugin(tocPlugin, {
    ul: true,
    tags: ["h1", "h2", "h3", "h4", "h5", "h6"],
  });
  eleventyConfig.addPlugin(pluginRss, {
    posthtmlRenderOptions: {
      closingSingleTag: "slash",
      singleTags: ["link"],
    },
  });

  userEleventySetup(eleventyConfig);

  return {
    dir: {
      input: "src/site",
      output: "dist",
      data: "_data",
    },
    templateFormats: ["njk", "md", "11ty.js"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: false,
    passthroughFileCopy: true,
    cacheDir: ".eleventy-cache"
  };
};
