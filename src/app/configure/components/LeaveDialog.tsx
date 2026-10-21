import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

interface LeaveDialogProps {
    isOpen: boolean;
    changeCount: number;
    onStay: () => void;
    onLeave: () => void;
}

/** Leaving the page or a mode with changes (spec 10.1) */
export function LeaveDialog({ isOpen, changeCount, onStay, onLeave }: LeaveDialogProps) {
    return (
        <Dialog isOpen={isOpen} onClose={onStay} title={`Leave with ${changeCount} ${changeCount === 1 ? "change" : "changes"} not applied?`} width={440}>
            <p className="text-sm text-body">They are kept until you close this tab.</p>
            <div className="mt-5 flex justify-end gap-2">
                <Button onClick={onStay}>Keep editing</Button>
                <Button variant="primary" onClick={onLeave}>Leave</Button>
            </div>
        </Dialog>
    );
}
