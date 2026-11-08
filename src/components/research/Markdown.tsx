import type { ElementType } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { createSlugger } from "@/lib/research/report";

// Renders the writer's markdown. No raw HTML (react-markdown escapes it), and unsafe
// link protocols are dropped by its default URL transform.

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const textOf = (node: HastNode): string =>
  node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join("");

/** Gives h2/h3 the same ids parseReportSections gives the table of contents. */
function rehypeHeadingIds() {
  return (tree: HastNode) => {
    const slug = createSlugger();
    const visit = (node: HastNode) => {
      if (node.type === "element" && (node.tagName === "h2" || node.tagName === "h3")) {
        node.properties = { ...node.properties, id: slug(textOf(node)) };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/** A markdown element with our classes. Drops react-markdown's `node` prop, which isn't a DOM attribute. */
function styled(Tag: ElementType, base: string, fixed?: Record<string, string>) {
  function Styled({ className, ...props }: { className?: string; node?: unknown }) {
    delete props.node;
    return <Tag className={cn(base, className)} {...props} {...fixed} />;
  }
  return Styled;
}

const TableInner = styled("table", "w-full text-left text-sm");

const components: Components = {
  h1: styled("h1", "mb-6 text-2xl font-semibold tracking-tight text-balance"),
  h2: styled("h2", "mt-10 mb-3 scroll-mt-4 border-b pb-2 text-lg font-semibold tracking-tight"),
  h3: styled("h3", "mt-6 mb-2 scroll-mt-4 text-base font-semibold"),
  h4: styled("h4", "mt-4 mb-2 font-semibold"),
  p: styled("p", "my-3 leading-7"),
  ul: styled("ul", "my-3 ml-5 list-disc space-y-1.5 marker:text-muted-foreground"),
  ol: styled("ol", "my-3 ml-5 list-decimal space-y-1.5 marker:text-muted-foreground"),
  li: styled("li", "pl-1 leading-7"),
  blockquote: styled("blockquote", "my-4 border-l-2 border-fuchsia-400/60 pl-4 text-muted-foreground italic"),
  a: styled("a", "break-words text-sky-300 underline-offset-2 hover:underline", {
    target: "_blank",
    rel: "noopener noreferrer nofollow",
  }),
  strong: styled("strong", "font-semibold text-foreground"),
  hr: styled("hr", "my-8 border-border"),
  code: styled("code", "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"),
  pre: styled("pre", "my-4 overflow-x-auto rounded-lg bg-muted p-3 text-xs [&_code]:bg-transparent [&_code]:p-0"),
  table: function Table(props) {
    return (
      <div className="my-4 overflow-x-auto rounded-lg border">
        <TableInner {...props} />
      </div>
    );
  },
  thead: styled("thead", "bg-muted/50"),
  th: styled("th", "border-b px-3 py-2 font-medium"),
  td: styled("td", "border-b px-3 py-2 align-top [tr:last-child_&]:border-b-0"),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-sm text-foreground/90", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHeadingIds]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
