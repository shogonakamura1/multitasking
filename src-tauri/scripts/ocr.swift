#!/usr/bin/env swift
/// Vision OCR helper.
/// Usage: swift ocr.swift <image-path>
/// Outputs recognized text lines to stdout (newline-separated).
/// On any failure, outputs nothing and exits 0.

import Foundation
import Vision

guard CommandLine.arguments.count >= 2 else {
    // No path given — exit silently.
    exit(0)
}

let imagePath = CommandLine.arguments[1]
let imageURL = URL(fileURLWithPath: imagePath)

guard let imageData = try? Data(contentsOf: imageURL),
      let cgImageSource = CGImageSourceCreateWithData(imageData as CFData, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(cgImageSource, 0, nil) else {
    exit(0)
}

let semaphore = DispatchSemaphore(value: 0)
var recognizedLines: [String] = []

let request = VNRecognizeTextRequest { (request, error) in
    defer { semaphore.signal() }
    guard error == nil,
          let observations = request.results as? [VNRecognizedTextObservation] else {
        return
    }
    for observation in observations {
        if let candidate = observation.topCandidates(1).first {
            let text = candidate.string.trimmingCharacters(in: .whitespaces)
            if !text.isEmpty {
                recognizedLines.append(text)
            }
        }
    }
}

request.recognitionLevel = .accurate
request.recognitionLanguages = ["ja-JP", "en-US"]
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    exit(0)
}

semaphore.wait()

let output = recognizedLines.joined(separator: "\n")
print(output)
