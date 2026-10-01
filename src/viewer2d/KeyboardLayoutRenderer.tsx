import { KEY_PITCH_MM } from '../geometry/layouts';
import type { KeyboardLayout, Point2D } from '../types/keyboard';
import { useStage } from './SvgStage';
import styles from './Viewer2D.module.css';

interface Props {
  layout: KeyboardLayout;
  /** Top-left corner of the layout in the parent frame (mm). */
  origin?: Point2D;
  /** Explicit key centres (mm) — e.g. from PCB switch positions. Overrides `origin`. */
  centers?: Point2D[];
  showLabels?: boolean;
  gap?: number;
}

/** Renders any key map as keycap rectangles (1u = 19.05 mm). */
export function KeyboardLayoutRenderer({ layout, origin = { x: 0, y: 0 }, centers, showLabels = true, gap = 1 }: Props) {
  const { k } = useStage();
  const showText = KEY_PITCH_MM * k > 22 && showLabels;
  return (
    <g aria-label={`${layout.name} key map`}>
      {layout.keys.map((key, i) => {
        const w = key.width * KEY_PITCH_MM - gap;
        const h = key.height * KEY_PITCH_MM - gap;
        const c = centers?.[i] ?? { x: origin.x + (key.x + key.width / 2) * KEY_PITCH_MM, y: origin.y + (key.y + key.height / 2) * KEY_PITCH_MM };
        return (
          <g key={i} transform={key.rotation ? `rotate(${key.rotation} ${c.x} ${c.y})` : undefined}>
            <rect className={styles['key']} x={c.x - w / 2} y={c.y - h / 2} width={w} height={h} rx={1.6} />
            {showText && (
              <text className={styles['keyLabel']} x={c.x} y={c.y} fontSize={Math.min(7, 11 / Math.max(1, key.label.length * 0.55))}>
                {key.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
