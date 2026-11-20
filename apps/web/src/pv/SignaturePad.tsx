import SignaturePadLib from "signature_pad";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui";

/**
 * Signature manuscrite au doigt ou au stylet (spec §3.2 étape 7), exportée en PNG (data URL). Le canevas est
 * dimensionné à la densité de l'écran pour un trait net.
 */
export function SignaturePad({
  label,
  valeur,
  onChange,
  disabled,
}: {
  label: string;
  valeur: string | null;
  onChange: (png: string | null) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [refaire, setRefaire] = useState(valeur === null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!refaire || disabled) return;
    const canvas = canvasRef.current;
    if (!canvas || !canvas.getContext?.("2d")) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const ajuster = () => {
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
      padRef.current?.clear();
    };
    ajuster();
    const pad = new SignaturePadLib(canvas, { penColor: "#0b1f4d", minWidth: 1, maxWidth: 3 });
    padRef.current = pad;
    const fin = () => onChangeRef.current(pad.isEmpty() ? null : pad.toDataURL("image/png"));
    pad.addEventListener("endStroke", fin);
    window.addEventListener("resize", ajuster);
    return () => {
      pad.removeEventListener("endStroke", fin);
      pad.off();
      window.removeEventListener("resize", ajuster);
      padRef.current = null;
    };
  }, [refaire, disabled]);

  if (!refaire && valeur) {
    return (
      <div className="space-y-2">
        <img
          src={valeur}
          alt={label}
          className="h-40 w-full rounded-lg border-2 border-slate-300 bg-white object-contain"
        />
        {!disabled && (
          <Button variant="secondary" onClick={() => setRefaire(true)}>
            Refaire la signature
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        aria-label={label}
        className="h-48 w-full touch-none rounded-lg border-2 border-dashed border-slate-400 bg-white"
      />
      <div className="flex gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            padRef.current?.clear();
            onChange(null);
          }}
        >
          Effacer
        </Button>
        <span className="self-center text-sm text-slate-600">Signez dans le cadre, au doigt ou au stylet.</span>
      </div>
    </div>
  );
}
