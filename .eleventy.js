const slugify = require("@sindresorhus/slugify");
const markdownIt = require("markdown-it");
const fs = require("fs");

const fileCache = new Map();
function getFrontMatter(filePath) {
  if (fileCache.has(filePath)) {
    return fileCache.get(filePath);
  }
  try {
    const file = fs.readFileSync(filePath, "utf8");
    const frontMatter = matter(file);
    fileCache.set(filePath, frontMatter);
    return frontMatter;
  } catch {
    return null;
  }
}

const matter = require("gray-matter");
const faviconsPlugin = require("eleventy-plugin-gen-favicons");
const tocPlugin = require("eleventy-plugin-nesting-toc");
const { parse } = require("node-html-parser");
const htmlMinifier = require("html-minifier-terser");
const pluginRss = require("@11ty/eleventy-plugin-rss");

const { headerToId, namedHeadingsFilter } = require("./src/helpers/utils");
const {
  userMarkdownSetup,
  userEleventySetup,
} = require("./src/helpers/userSetup");

// ===== 로그/에러 가드 유틸 =====
function safeWrapTransform(name, handler) {
  return function (content, outputPath) {
    try {
      return handler(content, outputPath);
    } catch (e) {
      console.error(
        `[11ty][Transform:${name}] Failed at ${outputPath ||
          "unknown outputPath"}: ${e && e.message}`
      );
      if (e && e.stack) console.error(e.stack);
      return content;
    }
  };
}

process.on("unhandledRejection", (err) => {
  console.error("[11ty][unhandledRejection]", err && err.stack || err);
});
process.on("uncaughtException", (err) => {
  console.error("[11ty][uncaughtException]", err && err.stack || err);
});

const Image = require("@11ty/eleventy-img");
function transformImage(src, cls, alt, sizes, widths = ["500", "700", "auto"]) {
  let options = {
    widths: widths,
    formats: ["webp", "jpeg"],
    outputDir: "./dist/img/optimized",
    urlPath: "/img/optimized",
  };

  if (process.env.ELEVENTY_ENV === "prod") Image(src, options);
  let metadata = Image.statsSync(src, options);
  return metadata;
}

function getAnchorLink(filePath, linkTitle) {
  const { attributes, innerHTML } = getAnchorAttributes(filePath, linkTitle);
  return `<a ${Object.keys(attributes)
    .map((key) => `${key}="${attributes[key]}"`)
    .join(" ")}>${innerHTML}</a>`;
}

function getAnchorAttributes(filePath, linkTitle) {
  // 파일 이름 / 헤더 분리
  const fileNameRaw = filePath.replaceAll("&amp;", "&");
  let [fileName, header] = [fileNameRaw, ""];
  let headerLinkPath = "";
  if (filePath.includes("#")) {
    [fileName, header] = filePath.split("#");
    headerLinkPath = `#${headerToId(header)}`;
  }

  let noteIcon = process.env.NOTE_ICON_DEFAULT;
  const title = linkTitle || fileName;
  let permalink = `/notes/${slugify(filePath)}`;
  let deadLink = false;

  // 실제 노트 파일 경로
  const startPath = "./src/site/notes/";
  const fullPath = fileName.endsWith(".md")
    ? `${startPath}${fileName}`
    : `${startPath}${fileName}.md`;

  try {
    const frontMatter = getFrontMatter(fullPath);
    if (!frontMatter || !frontMatter.data) {
      console.error(
        `[11ty][getAnchorAttributes][ERROR] no frontMatter.data at ${fullPath}`
      );
      deadLink = true;
    } else {
      // frontMatter 에서 permalink/tags/noteIcon 반영
      if (frontMatter.data.permalink) {
        permalink = frontMatter.data.permalink;
      }
      if (
        Array.isArray(frontMatter.data.tags) &&
        frontMatter.data.tags.includes("gardenEntry")
      ) {
        permalink = "/";
      }
      if (frontMatter.data.noteIcon) {
        noteIcon = frontMatter.data.noteIcon;
      }
    }
  } catch (e) {
    console.error(
      `[11ty][getAnchorAttributes][EXCEPTION] reading frontMatter from ${fullPath}:`,
      e
    );
    deadLink = true;
  }

  if (deadLink) {
    return {
      attributes: {
        class: "internal-link is-unresolved",
        href: "/404",
        target: "",
      },
      innerHTML: title,
    };
  }

  return {
    attributes: {
      class: "internal-link",
      target: "",
      "data-note-icon": noteIcon,
      href: `${permalink}${headerLinkPath}`,
    },
    innerHTML: title,
  };
}


const tagRegex = /(^|\s|\>)(#[^\s!@#$%^&*()=+\.,\[{\]};:'"?><]+)(?!([^<]*>))/g;

module.exports = function (eleventyConfig) {
  // 빌드 최적화 설정 - 새로 추가됨
  eleventyConfig.setUseGitIgnore(false);
  eleventyConfig.setWatchThrottleWaitTime(100);

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
      const origFenceRule =
        md.renderer.rules.fence ||
        function (tokens, idx, options, env, slf) {
          return slf.renderToken(tokens, idx, options);
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
          // ... (기존 ad- 핸들링 로직 생략 가능)
        }
        return origFenceRule(tokens, idx, options, env, slf);
      };

      const defaultImageRule =
        md.renderer.rules.image ||
        function (tokens, idx, options, env, self) {
          return self.renderToken(tokens, idx, options);
        };
      md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const imageName = tokens[idx].content;
        const [fileName, ...widthAndMetaData] = imageName.split("|");
        const lastValue = widthAndMetaData[widthAndMetaData.length - 1];
        const lastValueIsNumber = !isNaN(lastValue);
        const width = lastValueIsNumber ? lastValue : null;

        let metaData = "";
        if (widthAndMetaData.length > 1) {
          metaData = widthAndMetaData
            .slice(0, widthAndMetaData.length - 1)
            .join(" ");
        }
        if (!lastValueIsNumber) {
          metaData += ` ${lastValue}`;
        }

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

      const defaultLinkRule =
        md.renderer.rules.link_open ||
        function (tokens, idx, options, env, self) {
          return self.renderToken(tokens, idx, options);
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

  eleventyConfig.addFilter("isoDate", function (date) {
    return date && date.toISOString();
  });
  
  eleventyConfig.addFilter("link", function (str) {
    if (!str) return str;
    try {
      return str.replace(/\[\[(.*?\|.*?)\]\]/g, function (match, p1) {
        // Excalidraw / 수식 스니펫 예외
        if (p1.includes("],[") || p1.includes('"$"')) {
          return match;
        }
        const [fileLink, linkTitle] = p1.split("|");
        return getAnchorLink(fileLink, linkTitle);
      });
    } catch (e) {
      console.error("[11ty][Filter:link][ERROR] on:", str);
      console.error(e.stack || e);
      // 에러 났을 땐 원본 리턴
      return str;
    }
  });

  eleventyConfig.addFilter("taggify", function (str) {
    return (
      str &&
      str.replace(tagRegex, function (match, precede, tag) {
        return `${precede}<a class="tag" onclick="toggleTagSearch(this)" data-content="${tag}">${tag}</a>`;
      })
    );
  });
  eleventyConfig.addFilter("searchableTags", function (str) {
    let tags;
    let match = str && str.match(tagRegex);
    if (match) {
      tags = match
        .map((m) => `"${m.split("#")[1]}"`)
        .join(", ");
    }
    if (tags) {
      return `${tags},`;
    } else {
      return "";
    }
  });
  eleventyConfig.addFilter("hideDataview", function (str) {
    return (
      str &&
      str.replace(/\(\S+\:\:(.*)\)/g, function (_, value) {
        return value.trim();
      })
    );
  });

  // ===== 🚀 NEW: 자동 메타 디스크립션 생성 필터 추가 =====
  eleventyConfig.addFilter("autoMetaDescription", function (content) {
    if (!content) return "";
    const cleaned = content
      .replace(/<[^>]*>/g, " ")
      .replace(/#{1,6}\s/g, "")
      .replace(/\*\*(.*?)\*\*/g, "\$1")
      .replace(/\*(.*?)\*/g, "\$1")
      .replace(/\[\[(.*?)\]\]/g, "\$1")
      .replace(/\[(.*?)\]\(.*?\)/g, "\$1")
      .replace(/\s+/g, " ")
      .trim();
    const firstParagraph = cleaned.split("\n\n")[0] || cleaned;
    if (firstParagraph.length > 160) {
      const words = firstParagraph.split(" ");
      let result = "";
      for (const word of words) {
        if ((result + word).length > 157) break;
        result += word + " ";
      }
      return result.trim() + "...";
    }
    return firstParagraph;
  });
  // ===== 🚀 NEW 끝 =====

  // ========= 여기서부터 Transform 래핑 적용 =========

  eleventyConfig.addTransform(
    "dataview-js-links",
    safeWrapTransform("dataview-js-links", function (str, outputPath) {
      const parsed = parse(str);
      for (const dataViewJsLink of parsed.querySelectorAll(
        "a[data-href].internal-link"
      )) {
        const notePath = dataViewJsLink.getAttribute("data-href");
        const title = dataViewJsLink.innerHTML;
        const { attributes, innerHTML } = getAnchorAttributes(notePath, title);
        for (const key in attributes) {
          dataViewJsLink.setAttribute(key, attributes[key]);
        }
        dataViewJsLink.innerHTML = innerHTML;
      }
      return str && parsed.innerHTML;
    })
  );

  eleventyConfig.addTransform(
    "callout-block",
    safeWrapTransform("callout-block", function (str, outputPath) {
      const parsed = parse(str);
      const transformCalloutBlocks = (
        blockquotes = parsed.querySelectorAll("blockquote")
      ) => {
        for (const blockquote of blockquotes) {
          transformCalloutBlocks(blockquote.querySelectorAll("blockquote"));
          let content = blockquote.innerHTML;
          let titleDiv = "";
          let calloutType = "";
          let calloutMetaData = "";
          let isCollapsable;
          let isCollapsed;
          const calloutMeta = /\[!([\w-]*)\|?(\s?.*)\](\+|\-){0,1}(\s?.*)/;
          if (!content.match(calloutMeta)) {
            continue;
          }
          content = content.replace(
            calloutMeta,
            function (metaInfoMatch, callout, metaData, collapse, title) {
              isCollapsable = Boolean(collapse);
              isCollapsed = collapse === "-";
              const titleText = title.replace(/(<\/{0,1}\w+>)/, "")
                ? title
                : `${callout.charAt(0).toUpperCase()}${callout
                    .substring(1)
                    .toLowerCase()}`;
              const fold = isCollapsable
                ? `<div class="callout-fold"><i icon-name="chevron-down"></i></div>`
                : ``;
              calloutType = callout;
              calloutMetaData = metaData;
              titleDiv = `<div class="callout-title"><div class="callout-title-inner">${titleText}</div>${fold}</div>`;
              return "";
            }
          );
          if (content === "\n<p>\n") {
            content = "";
          }
          let contentDiv = content
            ? `\n<div class="callout-content">${content}</div>`
            : "";
          blockquote.tagName = "div";
          blockquote.classList.add("callout");
          blockquote.classList.add(isCollapsable ? "is-collapsible" : "");
          blockquote.classList.add(isCollapsed ? "is-collapsed" : "");
          blockquote.setAttribute("data-callout", calloutType.toLowerCase());
          calloutMetaData &&
            blockquote.setAttribute(
              "data-callout-metadata",
              calloutMetaData
            );
          blockquote.innerHTML = `${titleDiv}${contentDiv}`;
        }
      };
      transformCalloutBlocks();
      return str && parsed.innerHTML;
    })
  );

  function fillPictureSourceSets(src, cls, alt, meta, width, imageTag) {
    imageTag.tagName = "picture";
    let html = `<source
      media="(max-width:480px)"
      srcset="${meta.webp[0].url}"
      type="image/webp"
      />
      <source
      media="(max-width:480px)"
      srcset="${meta.jpeg[0].url}"
      />
      `;
    if (meta.webp && meta.webp[1] && meta.webp[1].url) {
      html += `<source
        media="(max-width:1920px)"
        srcset="${meta.webp[1].url}"
        type="image/webp"
        />`;
    }
    if (meta.jpeg && meta.jpeg[1] && meta.jpeg[1].url) {
      html += `<source
        media="(max-width:1920px)"
        srcset="${meta.jpeg[1].url}"
        />`;
    }
    html += `<img
      class="${cls.toString()}"
      src="${src}"
      alt="${alt}"
      width="${width}"
      />`;
    imageTag.innerHTML = html;
  }

  eleventyConfig.addTransform(
    "picture",
    safeWrapTransform("picture", function (str, outputPath) {
      if (process.env.USE_FULL_RESOLUTION_IMAGES === "true") {
        return str;
      }
      const parsed = parse(str);
      for (const imageTag of parsed.querySelectorAll(".cm-s-obsidian img")) {
        const src = imageTag.getAttribute("src");
        if (src && src.startsWith("/") && !src.endsWith(".svg")) {
          const cls = imageTag.classList.value;
          const alt = imageTag.getAttribute("alt");
          const width = imageTag.getAttribute("width") || "";
          try {
            const meta = transformImage(
              "./src/site" + decodeURI(imageTag.getAttribute("src")),
              cls.toString(),
              alt,
              ["(max-width: 480px)", "(max-width: 1024px)"]
            );
            if (meta) {
              fillPictureSourceSets(src, cls, alt, meta, width, imageTag);
            }
          } catch (e) {
            console.error(
              `[11ty][Transform:picture] Image transform failed at ${
                outputPath || "unknown"
              } for src=${src}: ${e && e.message}`
            );
          }
        }
      }
      return str && parsed.innerHTML;
    })
  );

  eleventyConfig.addTransform(
    "table",
    safeWrapTransform("table", function (str, outputPath) {
      const parsed = parse(str);
      for (const t of parsed.querySelectorAll(
        ".cm-s-obsidian > table"
      )) {
        let inner = t.innerHTML;
        t.tagName = "div";
        t.classList.add("table-wrapper");
        t.innerHTML = `<table>${inner}</table>`;
      }
      for (const t of parsed.querySelectorAll(
        ".cm-s-obsidian > .block-language-dataview > table"
      )) {
        t.classList.add("dataview");
        t.classList.add("table-view-table");
        t.querySelector("thead")?.classList.add("table-view-thead");
        t.querySelector("tbody")?.classList.add("table-view-tbody");
        t.querySelectorAll("thead > tr")?.forEach((tr) => {
          tr.classList.add("table-view-tr-header");
        });
        t.querySelectorAll("thead > tr > th")?.forEach((th) => {
          th.classList.add("table-view-th");
        });
      }
      return str && parsed.innerHTML;
    })
  );

  eleventyConfig.addTransform(
    "htmlMinifier",
    safeWrapTransform("htmlMinifier", (content, outputPath) => {
      try {
        if (
          (process.env.NODE_ENV === "production" ||
            process.env.ELEVENTY_ENV === "prod") &&
          outputPath &&
          outputPath.endsWith(".html") &&
          !outputPath.includes("rss.xml") &&
          !outputPath.includes("sitemap.xml") &&
          !outputPath.includes("feed.xml")
        ) {
          try {
            return htmlMinifier.minify(content, {
              useShortDoctype: true,
              removeComments: true,
              collapseWhitespace: true,
              conservativeCollapse: true,
              preserveLineBreaks: true,
              minifyCSS: true,
              minifyJS: true,
              keepClosingSlash: true,
            });
          } catch (err) {
            console.error(
              `[11ty][Transform:htmlMinifier] Minify failed at ${
                outputPath || "unknown"
              }: ${err && err.message}`
            );
            if (err && err.stack) console.error(err.stack);
            return content;
          }
        }
        return content;
      } catch (e) {
        console.error(
          `[11ty][Transform:htmlMinifier] Wrapper error at ${
            outputPath || "unknown"
          }: ${e && e.message}`
        );
        return content;
      }
    })
  );

  // ========= Transform 적용 끝 =========

  eleventyConfig.addPassthroughCopy("src/site/img");
  eleventyConfig.addPassthroughCopy("src/site/scripts");
  eleventyConfig.addPassthroughCopy("src/site/styles/_theme.*.css");
  eleventyConfig.addPassthroughCopy("src/site/ads.txt");
  eleventyConfig.addPlugin(faviconsPlugin, { outputDir: "dist" });
  eleventyConfig.addPlugin(tocPlugin, {
    ul: true,
    tags: ["h1", "h2", "h3", "h4", "h5", "h6"],
  });

  eleventyConfig.addFilter("dateToZulu", function (date) {
    try {
      return new Date(date).toISOString("dd-MM-yyyyTHH:mm:ssZ");
    } catch {
      return "";
    }
  });

  eleventyConfig.addFilter("dateToRfc822", function (date) {
    return new Date(date).toUTCString();
  });

  eleventyConfig.addFilter("getNewestCollectionItemDate", function (collection) {
    if (!collection || !collection.length) {
      return new Date();
    }
    return new Date(
      Math.max(
        ...collection.map((item) => {
          return item.date ? new Date(item.date).getTime() : 0;
        })
      )
    );
  });

  eleventyConfig.addFilter("jsonify", function (variable) {
    return JSON.stringify(variable) || '""';
  });

  eleventyConfig.addFilter("validJson", function (variable) {
    if (Array.isArray(variable)) {
      return variable.map((x) => x.replaceAll("\\", "\\\\")).join(",");
    } else if (typeof variable === "string") {
      return variable.replaceAll("\\", "\\\\");
    }
    return variable;
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
      data: `_data`,
    },
    templateFormats: ["njk", "md", "11ty.js"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: false,
    passthroughFileCopy: true,
    cacheDir: ".eleventy-cache",
    useGitIgnore: false,
    watchThrottleWaitTime: 100,
    incrementalBuild: true,
  };
};
