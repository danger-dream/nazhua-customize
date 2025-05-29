export default {
	async fetch(request, env) {
		const corsHeaders = new Headers()
		corsHeaders.set('Access-Control-Allow-Origin', '*')
		corsHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
		corsHeaders.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers'))

		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders })
		}
		const wrtiteResponse = (data, headers = {}, status = 200) => {
			corsHeaders.set('Content-Type', 'application/json')
			for (const k of Object.keys(headers)) {
				corsHeaders.set(k, headers[k])
			}
			return new Response(JSON.stringify(data), { status, headers: corsHeaders })
		}
		const errorResponse = (error, status = 400) => {
			return wrtiteResponse({ error }, {}, status)
		}
		try {
			const url = new URL(request.url)
			const type = url.searchParams.get('type')
			if (!type) {
				return errorResponse('bad request', 444)
			}
			if (type === 'ip-check-report') {
				const hash = url.searchParams.get('hash')
				if (!hash) {
					return errorResponse('Missing required parameters: type and hash')
				}
				const cacheKey = `${type}-${hash}`
				const cached = await env.IP_REPORTS.get(cacheKey)
				if (cached) {
					return wrtiteResponse(JSON.parse(cached))
				}
				const svgUrl = `https://report.check.place/ip/${hash}.svg`
				const svgResponse = await fetch(svgUrl)
				if (!svgResponse.ok) {
					return errorResponse('Failed to fetch SVG report', 404)
				}
				const svgContent = await svgResponse.text()
				const jsonData = await parseSVGToJSON(svgContent)
				const jsonString = JSON.stringify(jsonData, null, 2)
				// 缓存到KV
				await env.IP_REPORTS.put(cacheKey, jsonString)
				return wrtiteResponse(jsonData)
			} else {
				return errorResponse('Unsupported type. Only ip-check-report is supported.')
			}
		} catch (error) {
			return errorResponse('Internal server error', 500)
		}
	}
}

async function parseSVGToJSON(svgContent) {
	// 提取所有文本内容
	const textMatches = svgContent.match(/<tspan[^>]*>([\s\S]*?)<\/tspan>/g) || []
	const texts = textMatches
		.map(match => {
			// 提取开始和结束标签之间的内容
			const content = match.replace(/<tspan[^>]*>/, '').replace(/<\/tspan>/, '')
			return content.trim()
		})
		.filter(text => text.length > 0)
	const result = {}

	// 解析IP地址和基本信息
	const ipMatch = texts.find(t => t.includes('IP质量体检报告：'))
	if (ipMatch) {
		const nextIndex = texts.indexOf(ipMatch) + 1
		if (nextIndex < texts.length) {
			result.ip = texts[nextIndex]
		}
	}

	// 解析报告时间和版本
	const timeMatch = texts.find(t => t.includes('报告时间：'))
	if (timeMatch) {
		const timePattern = /报告时间：([^脚]+)脚本版本：(.+)$/
		const match = timeMatch.match(timePattern)
		if (match) {
			result.report_time = match[1].trim()
			result.version = match[2].trim()
		}
	}

	// 提取基础信息
	result.as = extractValue(texts, '自治系统号：')
	result.organization = extractValue(texts, '组织：')
	result.coordinate = extractValue(texts, '坐标：')
	result.map_url = extractValue(texts, '地图：')
	result.city = extractValue(texts, '城市：')
	result.use_address = extractValue(texts, '使用地：')
	result.reg_address = extractValue(texts, '注册地：')
	result.time_zone = extractValue(texts, '时区：')
	result.ip_type = extractValue(texts, 'IP类型：')

	// 解析IP类型属性
	result.ip_type_attr = parseIPTypeAttributes(texts)
	// 解析风险评分
	result.risk_score = parseRiskScores(texts)
	// 解析风险因子
	result.risk_factors = parseRiskFactors(texts)
	// 解析流媒体解锁
	result.stream_unlock = parseStreamUnlock(texts)
	// 解析邮件端口
	result.mail_25port = extractValue(texts, '本地25端口：')
	// 解析IP黑名单
	result.ip_blacklist = parseIPBlacklist(texts)
	return result
}

function extractValue(texts, key) {
	const index = texts.findIndex(t => t.includes(key))
	if (index !== -1 && index + 1 < texts.length) {
		return texts[index + 1]
	}
	return ''
}

function parseIPTypeAttributes(texts) {
	const databases = ['IPinfo', 'ipregistry', 'ipapi', 'AbuseIPDB', 'IP2LOCATION']
	const useTypeIndex = texts.findIndex(t => t.includes('使用类型：'))
	const companyTypeIndex = texts.findIndex(t => t.includes('公司类型：'))

	const result = []

	if (useTypeIndex !== -1) {
		// 解析使用类型（跳过标签，获取后续的值）
		const useTypes = []
		for (let i = useTypeIndex + 1; i < texts.length && useTypes.length < 5; i++) {
			if (texts[i] && texts[i].trim() !== '') {
				useTypes.push(texts[i])
			}
		}
		// 解析公司类型
		const companyTypes = []
		if (companyTypeIndex !== -1) {
			for (let i = companyTypeIndex + 1; i < texts.length && companyTypes.length < 5; i++) {
				if (texts[i] && texts[i].trim() !== '') {
					companyTypes.push(texts[i])
				}
			}
		}

		// 组合结果
		for (let i = 0; i < databases.length; i++) {
			result.push({
				name: databases[i],
				use_type: useTypes[i] || '',
				company_type: i < 3 ? companyTypes[i] || '' : ''
			})
		}
	}

	return result
}

function parseRiskScores(texts) {
	const riskServices = ['SCAMALYTICS：', 'ipapi：', 'AbuseIPDB：', 'IPQS：', 'Cloudflare：', 'DB-IP：']
	const result = []
	riskServices.forEach(service => {
		const index = texts.findIndex(t => t === service) // 精确匹配，而不是includes
		if (index !== -1 && index + 2 < texts.length) {
			const code = texts[index + 1].replace('|', '').trim()
			const label = texts[index + 2].trim()
			result.push({
				name: service.replace('：', ''),
				code: code,
				label: label
			})
		}
	})
	return result
}

function parseRiskFactors(texts) {
	const databases = ['IP2LOCATION', 'ipapi', 'ipregistry', 'IPQS', 'SCAMALYTICS', 'ipdata', 'IPinfo', 'IPWHOIS']
	const result = []

	// 通用提取函数：从指定索引开始提取指定数量的非空值
	const extractValues = (startIndex, count) => {
		const values = []
		if (startIndex !== -1) {
			for (let i = startIndex + 1; i < texts.length && values.length < count; i++) {
				if (texts[i].trim() !== '') {
					values.push(texts[i].trim())
				}
			}
		}
		return values
	}

	// 布尔值转换函数
	const convertToBoolean = value => {
		return value === '是' ? 1 : 0
	}

	// 找到各个风险因子的行
	const areaIndex = texts.findIndex(t => t.includes('地区：'))
	const proxyIndex = texts.findIndex(t => t.includes('代理：'))
	const torIndex = texts.findIndex(t => t.includes('Tor：'))
	const vpnIndex = texts.findIndex(t => t.includes('VPN：'))
	const serverIndex = texts.findIndex(t => t.includes('服务器：'))
	const abuseIndex = texts.findIndex(t => t.includes('滥用：'))
	const robotIndex = texts.findIndex(t => t.includes('机器人：'))

	// 提取地区（移除方括号）
	const areas = extractValues(areaIndex, 8).map(area => area.replace(/[\[\]]/g, ''))

	// 提取各种属性值
	const proxyValues = extractValues(proxyIndex, 8).map(convertToBoolean)
	const torValues = extractValues(torIndex, 8).map(convertToBoolean)
	const vpnValues = extractValues(vpnIndex, 8).map(convertToBoolean)
	const serverValues = extractValues(serverIndex, 8).map(convertToBoolean)
	const abuseValues = extractValues(abuseIndex, 8).map(convertToBoolean)
	const robotValues = extractValues(robotIndex, 8).map(convertToBoolean)

	databases.forEach((db, i) => {
		result.push({
			name: db,
			area: areas[i] || '',
			isProxy: proxyValues[i] || 0,
			isTor: torValues[i] || 0,
			isVPN: vpnValues[i] || 0,
			isServer: serverValues[i] || 0,
			isAubse: abuseValues[i] || 0,
			isRobot: robotValues[i] || 0
		})
	})

	return result
}

function parseStreamUnlock(texts) {
	const result = []

	// 找到服务商行，解析服务名称
	const serviceIndex = texts.findIndex(t => t.includes('服务商：'))
	let services = []
	if (serviceIndex !== -1 && serviceIndex + 1 < texts.length) {
		const serviceText = texts[serviceIndex + 1]
		services = serviceText.split(/\s+/).filter(s => s.length > 0)
		services = services.map(s => s.replace('&#43;', '+'))
	}

	// 找到状态行，连续取值
	const statusIndex = texts.findIndex((t, i) => t.includes('状态：') && i > serviceIndex)
	const statuses = []
	if (statusIndex !== -1) {
		for (let i = statusIndex + 1; i < texts.length && statuses.length < services.length; i++) {
			if (texts[i].trim() !== '') {
				statuses.push(texts[i].trim())
			} else {
				break
			}
		}
	}

	// 找到地区行，提取所有地区代码
	const areaIndex = texts.findIndex((t, i) => t.includes('地区：') && i > statusIndex)
	const availableAreas = []
	if (areaIndex !== -1 && areaIndex + 1 < texts.length) {
		const areaText = texts[areaIndex + 1]
		const regionMatches = areaText.match(/\[[A-Z]{2}\]/g) || []
		availableAreas.push(...regionMatches.map(region => region.replace(/[\[\]]/g, '')))
	}

	// 找到方式行，提取所有方式
	const methodIndex = texts.findIndex((t, i) => t.includes('方式：') && i > areaIndex)
	const availableMethods = []
	if (methodIndex !== -1) {
		for (let i = methodIndex + 1; i < texts.length; i++) {
			if (texts[i].trim() !== '' && !texts[i].includes('：')) {
				availableMethods.push(texts[i].trim())
			} else {
				break
			}
		}
	}

	const areas = []
	const methods = []
	let areaCounter = 0 // 地区数组的索引
	let methodCounter = 0 // 方式数组的索引

	statuses.forEach((status, i) => {
		if (status === '解锁' || status === '仅自制' || status === '待支持') {
			areas.push(availableAreas[areaCounter] || '')
			methods.push(availableMethods[methodCounter] || '')
			areaCounter++
			methodCounter++
		} else {
			// 屏蔽、失败等状态，地区和方式都为空
			areas.push('')
			methods.push('')
		}
	})
	// 组装结果
	services.forEach((service, i) => {
		result.push({
			name: service,
			service: statuses[i] || '',
			area: areas[i] || '',
			method: methods[i] || ''
		})
	})

	return result
}

function parseIPBlacklist(texts) {
	const blacklistIndex = texts.findIndex(t => t.includes('IP地址黑名单数据库：'))

	if (blacklistIndex !== -1) {
		// 查找包含数字的文本
		const numbers = []
		for (let i = blacklistIndex; i < Math.min(blacklistIndex + 10, texts.length); i++) {
			const text = texts[i]
			const matches = text.match(/\d+/g)
			if (matches) {
				numbers.push(...matches.map(Number))
			}
		}

		if (numbers.length >= 4) {
			return {
				valid: numbers[0],
				normal: numbers[1],
				marked: numbers[2],
				blacklist: numbers[3]
			}
		}
	}

	return { valid: 0, normal: 0, marked: 0, blacklist: 0 }
}
