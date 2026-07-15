require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'KilneGitNative'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.source         = { git: 'https://github.com/example/kilne-git-native' }

  s.ios.deployment_target = '15.1'
  s.tvos.deployment_target = '15.1'

  s.source_files = 'ios/**/*.{swift,h,m,cpp}'
  s.public_header_files = 'ios/**/*.h'

  s.dependency 'React-Core'
  s.dependency 'react-native-nitro-modules'
end
