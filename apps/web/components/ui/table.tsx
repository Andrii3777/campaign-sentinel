import type { ComponentProps } from "react";

/** Dense data table: hairline rows, fixed columns, tabular figures. Scrolls sideways inside its card on narrow screens. */
export function Table({ className = "", ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse text-left text-sm ${className}`} {...props} />
    </div>
  );
}

export function Th({ className = "", ...props }: ComponentProps<"th">) {
  return <th scope="col" className={`border-b border-hairline px-3 py-2 text-xs font-semibold whitespace-nowrap text-ink-2 ${className}`} {...props} />;
}

export function Td({ className = "", ...props }: ComponentProps<"td">) {
  return <td className={`border-b border-hairline px-3 py-2 align-middle ${className}`} {...props} />;
}

export function Tr({ className = "", ...props }: ComponentProps<"tr">) {
  return <tr className={`hover:bg-ground/60 ${className}`} {...props} />;
}
