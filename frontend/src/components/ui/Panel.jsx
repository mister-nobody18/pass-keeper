import { cn } from '../../utils/cn.js';

const PADDING = {
    none: '',
    md: 'p-5',
    lg: 'p-8',
};

export default function Panel({ as: Tag = 'div', padding = 'md', className, children, ...rest }) {
    return (
        <Tag
            className={cn(
                'rounded-lg border border-line bg-surface-raised shadow-panel',
                PADDING[padding],
                className
            )}
            {...rest}
        >
            {children}
        </Tag>
    );
}
