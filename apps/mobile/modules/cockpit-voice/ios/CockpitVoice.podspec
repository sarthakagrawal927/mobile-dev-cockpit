require "json"

package = JSON.parse(File.read(File.join(__dir__, "..", "package.json")))

Pod::Spec.new do |s|
  s.name           = "CockpitVoice"
  s.version        = package["version"]
  s.summary        = package["description"]
  s.description    = package["description"]
  s.license        = { :type => "MIT" }
  s.author         = "Mobile Dev Cockpit"
  s.homepage       = "https://github.com/sarthakagrawal927/mobile-dev-cockpit"
  s.platforms      = { :ios => "16.4" }
  s.swift_version  = "5.9"
  s.source         = { :git => "" }
  s.static_framework = true
  s.source_files   = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.frameworks     = "Speech", "AVFAudio"
  s.dependency "ExpoModulesCore"
end
