export type LineBufferHandlers = {
    onLine: (line: string) => void;
    onLineTooLong?: () => void;
};

export type LineBuffer = {
    push: (chunk: string) => void;
    flush: () => void;
};

export function createLineBuffer(maxLineLength: number, handlers: LineBufferHandlers): LineBuffer {
    if (!Number.isFinite(maxLineLength) || maxLineLength <= 0) {
        throw new Error('maxLineLength must be a positive finite number');
    }

    let currentLine = '';
    let skippingLine = false;
    function push(chunk: string): void {
        let lineStart = 0;

        for (let i = 0; i < chunk.length; i += 1) {
            if (chunk[i] !== '\n') {
                continue;
            }

            appendSegment(chunk.slice(lineStart, i));
            if (!skippingLine) {
                handlers.onLine(stripTrailingCarriageReturn(currentLine));
            }

            currentLine = '';
            skippingLine = false;
            lineStart = i + 1;
        }

        appendSegment(chunk.slice(lineStart));
    }

    function flush(): void {
        if (currentLine.length === 0 || skippingLine) {
            currentLine = '';
            skippingLine = false;
            return;
        }
        handlers.onLine(stripTrailingCarriageReturn(currentLine));
        currentLine = '';
    }

    function appendSegment(segment: string): void {
        if (skippingLine || segment.length === 0) {
            return;
        }

        const nextLength = currentLine.length + segment.length;
        if (nextLength > maxLineLength) {
            currentLine = '';
            skippingLine = true;
            handlers.onLineTooLong?.();
            return;
        }

        currentLine += segment;
    }

    return { push, flush };
}

function stripTrailingCarriageReturn(line: string): string {
    return line.endsWith('\r') ? line.slice(0, -1) : line;
}
