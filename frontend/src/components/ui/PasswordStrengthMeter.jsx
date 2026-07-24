import { useMemo } from 'react';
import { estimatePasswordStrength } from '../../utils/passwordStrength.js';
import { cn } from '../../utils/cn.js';

const SEGMENT_TONE = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-accent', 'bg-success'];
const LABEL_TONE = ['text-danger', 'text-danger', 'text-warning', 'text-accent', 'text-success'];

export default function PasswordStrengthMeter({ password, context = [] }) {
    const result = useMemo(() => estimatePasswordStrength(password, context), [password, context]);

    if (!password) return null;

    return (
        <div className="space-y-1.5" aria-live="polite">
            <div className="flex gap-1" role="img" aria-label={`Password strength: ${result.label}`}>
                {[0, 1, 2, 3].map((i) => (
                    <span
                        key={i}
                        className={cn(
                            'h-1 flex-1 rounded-full transition-colors duration-base',
                            i <= result.score ? SEGMENT_TONE[result.score] : 'bg-line'
                        )}
                    />
                ))}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
                <span className={cn('font-medium', LABEL_TONE[result.score])}>{result.label}</span>
                <span className="font-mono text-ink-tertiary">crack time: {result.crackTimeLabel}</span>
            </div>
            {result.feedback.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink-tertiary">
                    {result.feedback.map((tip) => (
                        <li key={tip}>{tip}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}
