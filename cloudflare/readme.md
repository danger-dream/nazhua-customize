
### 解析 `bash <(curl -sL IP.Check.Place) -y` 脚本执行后获取到的svg hash，将其转换为json格式

### 需绑定一个kv库做缓存，变量名称 `IP_REPORTS`

### 部署好后在自定义代码中搜索 `IPQualityReportBaseURL` 变量进行更换

### 部署好后可使用 `https://{you_domian}/?type=ip-check-report&hash={hash}` 进行测试
> 比如: https://ipq.08310507.xyz/?type=ip-check-report&hash=36Z23PMVB