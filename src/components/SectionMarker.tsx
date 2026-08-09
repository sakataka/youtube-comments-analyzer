type Props = {
  index: string;
  label?: string;
};

export function SectionMarker({ index, label }: Props) {
  return (
    <div className={label ? "section-marker section-marker--labeled" : "section-marker"} aria-hidden="true">
      <span className="section-marker__index">{index}</span>
      {label ? <span className="section-marker__label">{label}</span> : null}
      <span className="section-marker__line" />
    </div>
  );
}
