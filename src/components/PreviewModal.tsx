"use client";

import { useEffect, useState, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

interface PreviewImage {
    src: string;
    caption: string;
    // Optional: distinct alt text if different from caption
    alt?: string;
}

interface PreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    images: PreviewImage[];
}

export function PreviewModal({ isOpen, onClose, title, images }: PreviewModalProps) {
    const [currentIndex, setCurrentIndex] = useState(0);

    // Reset index when modal opens with new images
    useEffect(() => {
        if (isOpen) {
            setCurrentIndex(0);
        }
    }, [isOpen]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!isOpen) return;

        if (e.key === "Escape") onClose();
        if (e.key === "ArrowLeft") prevImage();
        if (e.key === "ArrowRight") nextImage();
    }, [isOpen, onClose]);

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);

    if (!isOpen) return null;

    const currentImage = images[currentIndex];

    const nextImage = () => {
        setCurrentIndex((prev) => (prev + 1) % images.length);
    };

    const prevImage = () => {
        setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-5xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
                    <h3 className="text-lg font-semibold text-zinc-100 pl-2">
                        {title} <span className="text-zinc-500 text-sm ml-2">({currentIndex + 1}/{images.length})</span>
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Main Image Area */}
                <div className="flex-1 relative bg-black flex items-center justify-center min-h-[300px] overflow-hidden group">
                    {/* Navigation Buttons (visible on hover or focus) */}
                    {images.length > 1 && (
                        <>
                            <button
                                onClick={(e) => { e.stopPropagation(); prevImage(); }}
                                className="absolute left-4 p-3 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 -translate-x-2 group-hover:translate-x-0"
                            >
                                <ChevronLeft className="h-6 w-6" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); nextImage(); }}
                                className="absolute right-4 p-3 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 translate-x-2 group-hover:translate-x-0"
                            >
                                <ChevronRight className="h-6 w-6" />
                            </button>
                        </>
                    )}

                    {/* Image */}
                    <div className="w-full h-full flex items-center justify-center p-4">
                        <img
                            src={currentImage.src}
                            alt={currentImage.alt || currentImage.caption}
                            className="max-w-full max-h-[70vh] object-contain shadow-2xl rounded-lg"
                        />
                    </div>
                </div>

                {/* Footer / Caption */}
                <div className="p-4 bg-zinc-900 border-t border-zinc-800 text-center">
                    <p className="text-zinc-300 font-medium text-base mb-2">
                        {currentImage.caption}
                    </p>

                    {/* Dots Indicator */}
                    {images.length > 1 && (
                        <div className="flex justify-center gap-1.5 mt-2">
                            {images.map((_, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setCurrentIndex(idx)}
                                    className={`w-2 h-2 rounded-full transition-colors ${idx === currentIndex ? "bg-blue-500" : "bg-zinc-700 hover:bg-zinc-600"
                                        }`}
                                />
                            ))}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
