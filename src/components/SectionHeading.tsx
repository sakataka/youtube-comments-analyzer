import { ReactNode } from "react";

type Props = {
  id: string;
  title: string;
  description: string;
  aside?: ReactNode;
  compact?: boolean;
};

export function SectionHeading({ id, title, description, aside, compact = false }: Props) {
  return (
    <div className={compact ? "section-title-row" : "section-heading"}>
      <div><h2 id={id}>{title}</h2><p>{description}</p></div>
      {aside}
    </div>
  );
}
