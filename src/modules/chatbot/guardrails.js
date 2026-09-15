// ============================================================================
// GUARDRAILS — el asistente SOLO habla de búsqueda de propiedades en DotCasa
// y de información oficial de DotCasa. Todo lo demás se rechaza aquí, antes de
// gastar una llamada a OpenAI, y se vuelve a revisar la respuesta del modelo.
//
// Los usuarios pueden escribir en CUALQUIER idioma. Los patrones cubren
// español, inglés, portugués, italiano, francés y alemán; para el resto
// (incluidos alfabetos no latinos) la última palabra la tiene el prompt y la
// revisión de salida. Las respuestas fijas se devuelven en el idioma detectado.
// ============================================================================
import { normalizeSearchText } from '../../shared/utils.js';

export const MAX_MESSAGE_LENGTH = 600;

// ---------------------------------------------------------------------------
// Patrones (sobre texto normalizado: minúsculas y sin acentos)
// ---------------------------------------------------------------------------

// Portales de la competencia. "casas y terrenos" es una búsqueda válida, por
// eso solo se bloquea la marca escrita junta ("casasyterrenos").
const COMPETIDORES = [
  /inmuebles\s*24/, /easy\s*broker/, /\blamudi\b/, /vivanuncios/,
  /propiedades\.com/, /metros\s*cubicos/, /\btrovit\b/, /casasyterrenos/
];
const COMPARACION_COMPETENCIA = [
  /\bcompetencia\b/, /\bcompetitors?\b/, /\bconcorren(cia|te|tes|za|ti)\b/, /\bconcurren(ce|ts?)\b/, /\bkonkurren(z|ten)\b/,
  /\b(otras?|otros|outras?|outros|altre|altri|autres?)\s+(paginas?|portales?|portais|portali|portails?|plataformas?|piattaforme|plateformes?|apps?|aplicaciones|sitios?|sites?|siti)\b/,
  /\bother\s+(sites?|websites?|portals?|platforms?|apps?)\b/,
  /\b(mejor|peor|melhor|pior)\s+que\s+dotcasa\b/, /\b(better|worse)\s+than\s+dotcasa\b/,
  /\b(meglio|peggio)\s+di\s+dotcasa\b/, /\b(meilleur|pire)\s+que\s+dotcasa\b/
];

// IA en general. La FAQ oficial sobre la búsqueda con IA de DotCasa sí se
// permite (ver esPreguntaIADotcasa).
const IA_GENERAL = [
  /\bchat\s*gpt\b/, /\bgpt[\s-]*\d*/, /\bopenai\b/, /\bgemini\b/, /\bclaude\b/,
  /\bcopilot\b/, /\bllm\b/, /\bmachine learning\b/, /\bdeep learning\b/,
  /\binteligencia artificial\b/, /\bartificial intelligence\b/, /\bintelligenza artificiale\b/,
  /\bintelligence artificielle\b/, /\bkunstliche intelligenz\b/,
  /\bmodel(o|e|lo)? (de |di )?(lenguaje|linguagem|linguistico|langage|ia|ai)\b/, /\blanguage model\b/, /\bsprachmodell\b/,
  /\b(ai|ia|llm|ki)[ -]?(model|modelo|modello|modele|modell)\b/, /\bmodel(o|lo|e)? (de |di |d')?(ia|ai)\b/,
  /\bred(es)? neuronal/, /\bneural net/, /\brede neural/,
  // Solo "qué modelo ERES/USAS": "¿qué modelo de casa tienen?" es inmobiliario.
  /\b(que|what|which|qual|quale|quel) mod(elo|el|ello|ele) (eres|usas|utilizas|are you|do you use|is this|e voce|voce usa|sei|usi|es-tu|utilises|bist du)\b/,
  /\b(quien|who|quem|chi|qui) te (creo|hizo|programo|entreno)\b/, /\bwho (created|made|built|trained|programmed) you\b/,
  /\bquem (te )?(criou|fez|treinou)\b/, /\bchi ti ha (creato|fatto|addestrato)\b/, /\bqui t'?a (cree|fait|entraine)\b/,
  /\b(una|la|eres) ia\b/, /\bare you (an? )?(ai|robot|bot|human|person)\b/, /\bvoce e (uma )?(ia|robo|bot|humano)\b/,
  /\bsei (un'?|una )?(ia|robot|bot|umano)\b/, /\bes-?tu (une |un )?(ia|robot|bot|humain)\b/,
  /\beres (un )?(robot|bot|humano|persona)\b/
];

const INYECCION = [
  /ignora\s+(todas?\s+)?(las|tus|le)\s+(instrucciones|reglas|istruzioni|regole)/,
  /olvida\s+(tus|las)\s+(instrucciones|reglas)/,
  /\bignore\s+(all\s+)?(the\s+|your\s+|previous\s+|prior\s+|above\s+)*(instructions|rules)/,
  /\bforget\s+(all\s+)?(your|the|previous)\s+(instructions|rules)/,
  /\bignore\s+(as\s+|suas\s+)?(instrucoes|regras)/, /\bignore[rz]?\s+(les|tes|vos)\s+(instructions|regles)/,
  /\bignoriere\b/, /\bsystem\s*prompt\b/, /\bprompt\b/, /\bjailbreak\b/,
  /modo\s+(desarrollador|developer|dios|desenvolvedor)/, /\bdeveloper mode\b/, /\bdan mode\b/,
  /\bactua\s+como\b/, /\bact\s+as\b/, /\baja\s+como\b/, /\bagisci\s+come\b/, /\bagis\s+comme\b/,
  /\bfinge\s+(que|ser)\b/, /\bpretend\s+(to\s+be|you|that)\b/, /\bfinja\b/, /\bfingi\b/,
  /\broleplay\b/, /\b(tus|your|suas|tue|tes|vos) (instrucciones|instructions|instrucoes|istruzioni)\b/
];

const MATEMATICAS = [
  /\becuacion/, /\bequa(tion|cao|coes|zione)/, /\bgleichung/,
  /\bderivad[ao]/, /\bderivative/, /\bderivata/, /\bderivee/, /\bableitung/,
  /\bintegral(es)?\b/, /\bintegrale\b/,
  /\braiz cuadrada\b/, /\bsquare root\b/, /\braiz quadrada\b/, /\bradice quadrata\b/, /\bracine carree\b/,
  /\blogarit/, /\blogarithm/, /\balgebra\b/, /\balgebre\b/, /\btrigonometr/,
  /\bmatematica/, /\bmath/, /\bmatemat/,
  /\bresuelve\b/, /\bsolve\b/, /\bresolva\b/, /\brisolvi\b/, /\bresous\b/, /\blose\b.*\bgleichung/,
  /\bcalculadora\b/, /\bcalculator\b/, /\bcalcolatrice\b/, /\bcalculatrice\b/, /\btaschenrechner\b/,
  /\bmultiplica/, /\bmultiply\b/, /\bmoltiplica/, /\bdivide\b/, /\bdividi\b/,
  /\bfraccion(es)?\b/, /\bteorema\b/, /\btheorem\b/, /\btheoreme\b/,
  // "¿cuánto es 5 + 3?" / "what is 12 times 4" (sin la "x": "10x20" es un terreno)
  /\b(cuanto es|cuanto da|what is|whats|how much is|quanto e|quanto fa|quanto da|combien fait|was ist)\s+-?\d+([.,]\d+)?\s*([+*/^÷]|mas\b|menos\b|por\b|entre\b|plus\b|minus\b|times\b|divided\b|multiplied\b|piu\b|meno\b|mais\b|vezes\b|fois\b|mal\b)/
];
// Expresión aritmética suelta ("25*4", "3+3=").
const EXPRESION_ARITMETICA = /\d\s*[+*/^÷=]\s*\d|\d\s*=\s*\?/;

const YOUTUBERS = [
  /\byoutubers?\b/, /\byoutube\b/, /\btiktok(ers?)?\b/, /\binfluencers?\b/, /\binfluenciadores?\b/,
  /\bstreamers?\b/, /\btwitch\b/, /\bvloggers?\b/,
  /\bcreadores? de contenido\b/, /\bcontent creators?\b/, /\bcriador(es)? de conteudo\b/,
  /\bcreator(e|i) di contenuti\b/, /\bcreateurs? de contenu\b/
];

// Los códigos postales son un dato de ubicación válido y no se bloquean.
const CODIGO = [
  /\bcodigo\b(?!\s+postal)/, /(?<!\b(zip|postal|area|country)\s)\bcode\b/, /\bcoding\b/,
  /\bcodice\b(?!\s+(postale|fiscale))/, /\bcodes?\s+(source|informatique)\b/, /\bquellcode\b/,
  /\bprogramar\b/, /\bprogramacion\b/, /\bprogramacao\b/, /\bprogramming\b/, /\bprogrammare\b/,
  /\bprogrammazione\b/, /\bprogrammation\b/, /\bprogrammier/,
  /\bjavascript\b/, /\btypescript\b/, /\bpython\b/, /\bhtml\b/, /\bcss\b/, /\bsql\b/, /\breact\b/,
  /\bnode(\.?js)?\b/, /\bphp\b/, /\bjava\b/, /\bscripts?\b/, /\balgorit/, /\bdebug/,
  /\bcompil(ar|e|er|are)\b/, /\bbackend\b/, /\bfrontend\b/,
  /\bfuncion en\b/, /\bfunction in\b/, /\bfuncao em\b/, /\bfunzione in\b/
];

const LANDING = [
  /\blanding\b/, /\bpaginas? web\b/, /\bsitios? web\b/, /\bdiseno web\b/, /\bwordpress\b/,
  /\bweb ?pages?\b/, /\bweb ?sites?\b/, /\bweb design\b/, /\bsites? (web|internet)\b/,
  /\bsiti? web\b/, /\bpagine web\b/, /\bsito\b/, /\bwebseite\b/, /\bhomepage\b/,
  /\b(crea|creame|hazme|haz|disena)(me)?\s+(una|un)\s+(pagina|sitio|web|app)/,
  /\b(build|make|create|design|code)\s+(me\s+)?(an?\s+)?(page|site|website|app)\b/,
  /\b(cria|crie|faca|faz)(-me)?\s+(uma?\s+)?(pagina|site|app)\b/,
  /\b(crea|fai|fammi)\s+(una?\s+)?(pagina|sito|app)\b/,
  /\b(cree|creer|fais)(-moi)?\s+(une?\s+)?(page|site|app)\b/
];

// "¿Qué puedes hacer?": respuesta fija limitada a DotCasa.
const CAPACIDADES = [
  /\bque (puedes|sabes) hacer\b/, /\bque mas (puedes|sabes)\b/, /\ben que (me )?(puedes|podrias) ayudar\b/,
  /\bcuales son tus (funciones|capacidades|habilidades)\b/, /\bpara que sirves\b/, /\bque haces\b/,
  /\bwhat (can|else can) you do\b/, /\bwhat do you do\b/, /\bhow can you help\b/,
  /\bwhat are (your|you) (capabilities|functions|skills|features|good for)\b/, /\bwhat are you for\b/,
  /\bo que (voce )?(pode|sabe|consegue) fazer\b/, /\bcomo (voce )?pode (me )?ajudar\b/, /\bpara que (voce )?serve\b/,
  /\bcosa (puoi|sai) fare\b/, /\bcome (mi )?puoi aiutare\b/, /\ba cosa servi\b/,
  /\bque (peux|sais)[- ]tu faire\b/, /\bque pouvez[- ]vous faire\b/, /\bcomment (peux[- ]tu|pouvez[- ]vous) m'?aider\b/,
  /\bwas kannst du\b/
];

// Temas oficiales de DotCasa (publicar, planes, contacto, legales...).
const INFO_DOTCASA = [
  /\bdotcasa\b/,
  // publicar / planes / precios
  /\bpublicar\b/, /\bpublico\b/, /\banunciar\b/, /\banuncios?\b/, /\bpublish\b/, /\blist (my|a|your)\b/, /\bto list\b/, /\blistings? (plan|price|fee|cost)/,
  /\badvertis/, /\bpubblicare\b/, /\bannunci/, /\bpublier\b/, /\bannonces?\b/, /\binserieren\b/,
  /\bplan(es|s|os|i)?\b/, /\bpricing\b/, /\bsuscripcion/, /\bsubscription/, /\bassinatura/,
  /\babbonament/, /\babonnement/, /\bcomision/, /\bcommission/, /\bcomissao/, /\bcommissione/,
  /\bprovision\b/, /\bcargos? ocultos?\b/, /\bhidden (fees|charges)\b/, /\bfees?\b/,
  /\breembols/, /\brefund/, /\brimbors/, /\bremboursement/,
  // contacto / redes / empresa
  /\bcontacto\b/, /\bcontact\b/, /\bcontato\b/, /\bcontatto\b/, /\bkontakt\b/, /\bcontactarlos\b/,
  /\bcorreo\b/, /\bemail\b/, /\be-mail\b/, /\btelefono de (ustedes|dotcasa)\b/, /\bphone number\b/,
  /\bredes sociales\b/, /\bsocial (media|networks?)\b/, /\bredes sociais\b/, /\breseaux sociaux\b/,
  /\bfacebook\b/, /\binstagram\b/, /\blinkedin\b/,
  /\bmision\b/, /\bmission\b/, /\bmissao\b/, /\bmissione\b/,
  /\bquienes son\b/, /\bnosotros\b/, /\babout (you|us)\b/, /\bwho are you\b/, /\bquem (sao|e voce)\b/,
  /\bchi siete\b/, /\bqui etes[- ]vous\b/,
  // legales
  /\bterminos\b/, /\bterms\b/, /\btermos\b/, /\btermini\b/, /\btermes\b/, /\bcondiciones\b/,
  /\bconditions\b/, /\bcondicoes\b/, /\bcondizioni\b/, /\bprivacidad\b/, /\bprivacy\b/,
  /\bprivacidade\b/, /\bconfidentialite\b/, /\bdatenschutz\b/, /\bdatos personales\b/,
  /\bpersonal data\b/, /\bdados pessoais\b/, /\bdati personali\b/, /\bdonnees personnelles\b/, /\bcookies\b/,
  // herramientas para anunciantes
  /\bleads?\b/, /\bpanel\b/, /\bmetricas\b/, /\bmetrics\b/, /\bdashboard\b/, /\bcsv\b/, /\bcrm\b/,
  /\bapi\b/, /\bparticular(es)?\b/, /\bprivate (seller|owner|individual)\b/
];

// ---------------------------------------------------------------------------
// Idioma de las respuestas fijas
// ---------------------------------------------------------------------------
const MARCADORES_IDIOMA = {
  en: ['the', 'what', 'you', 'your', 'are', 'can', 'how', 'who', 'which', 'with', 'and', 'please', 'want', 'looking', 'house', 'houses', 'apartment', 'bedroom', 'bedrooms', 'rent', 'sale', 'buy', 'is', 'does', 'near', 'write', 'of', 'to', 'my', 'i', 'it', 'that', 'have', 'any', 'find', 'show', 'give', 'tell', 'this', 'like', 'other', 'some', 'build', 'make', 'create', 'website', 'much', 'cost', 'list'],
  pt: ['voce', 'nao', 'uma', 'com', 'sao', 'quem', 'obrigado', 'obrigada', 'aluguel', 'quero', 'preciso', 'meu', 'minha', 'isso', 'voces', 'quartos', 'banheiros', 'faz', 'fazer', 'ola', 'estou', 'procurando', 'um', 'mim', 'crie', 'cria', 'eu', 'onde', 'tem', 'custa', 'anunciar', 'alugar', 'quanto'],
  it: ['che', 'sei', 'sono', 'il', 'della', 'puoi', 'voglio', 'cerco', 'affitto', 'grazie', 'gli', 'ciao', 'fare', 'vendita', 'camere', 'bagni', 'dove', 'chi', 'fa', 'per', 'dimmi', 'fammi', 'quanto', 'costa', 'pubblicare'],
  fr: ['les', 'des', 'est', 'vous', 'je', 'pas', 'une', 'avec', 'pour', 'quoi', 'bonjour', 'merci', 'cherche', 'maison', 'chambres', 'louer', 'faire', 'suis'],
  de: ['der', 'die', 'ist', 'ich', 'du', 'nicht', 'und', 'mit', 'haus', 'wohnung', 'suche', 'bitte', 'danke', 'was', 'kannst', 'zimmer', 'miete', 'kaufen'],
  es: ['el', 'los', 'las', 'es', 'eres', 'puedes', 'quiero', 'busco', 'necesito', 'hola', 'gracias', 'cual', 'quien', 'cuanto', 'y', 'del', 'al', 'por', 'con', 'una', 'que', 'en', 'casas', 'recamaras', 'renta', 'venta', 'departamento', 'banos', 'dime', 'hazme']
};

export function detectLanguage(message) {
  const raw = String(message || '');
  // Alfabetos no latinos (cirílico, árabe, CJK, etc.): se responde en inglés.
  const letras = raw.match(/\p{L}/gu) || [];
  const noLatinas = letras.filter(ch => !/[\u0000-\u024F]/.test(ch)).length;
  if (letras.length && noLatinas / letras.length > 0.5) return 'en';

  const tokens = normalizeSearchText(raw).split(/[^a-z0-9]+/).filter(Boolean);
  let mejor = 'es', puntos = 0;
  for (const [lang, palabras] of Object.entries(MARCADORES_IDIOMA)) {
    const set = new Set(palabras);
    const n = tokens.filter(t => set.has(t)).length;
    // Empate o cero: se queda en español, el idioma principal del portal.
    if (n > puntos) { mejor = lang; puntos = n; }
  }
  return mejor;
}

const TEXTOS = {
  fueraDeTema: {
    es: 'Solo puedo ayudarte a buscar propiedades en DotCasa o a resolver dudas sobre nuestra plataforma. Por ejemplo: "casas en venta en Cumbres, Monterrey, con 3 recámaras y 2 baños".',
    en: 'I can only help you search for properties on DotCasa or answer questions about our platform. For example: "3-bedroom houses for sale in Cumbres, Monterrey".',
    pt: 'Só posso ajudar você a buscar imóveis na DotCasa ou tirar dúvidas sobre a nossa plataforma. Por exemplo: "casas à venda em Cumbres, Monterrey, com 3 quartos".',
    it: 'Posso aiutarti solo a cercare immobili su DotCasa o a rispondere a domande sulla nostra piattaforma. Ad esempio: "case in vendita a Cumbres, Monterrey, con 3 camere".',
    fr: 'Je peux uniquement vous aider à chercher des biens sur DotCasa ou répondre à vos questions sur notre plateforme. Par exemple : « maisons à vendre à Cumbres, Monterrey, avec 3 chambres ».',
    de: 'Ich kann dir nur bei der Suche nach Immobilien auf DotCasa helfen oder Fragen zu unserer Plattform beantworten. Zum Beispiel: „Häuser zum Kauf in Cumbres, Monterrey, mit 3 Schlafzimmern".'
  },
  competencia: {
    es: 'Solo puedo darte información de DotCasa. Si me dices qué buscas (renta o venta, tipo de inmueble y zona), te muestro las opciones disponibles aquí.',
    en: 'I can only share information about DotCasa. Tell me what you are looking for (rent or buy, property type and area) and I will show you the options available here.',
    pt: 'Só posso dar informações sobre a DotCasa. Diga o que você procura (aluguel ou compra, tipo de imóvel e região) e eu mostro as opções disponíveis aqui.',
    it: 'Posso darti informazioni solo su DotCasa. Dimmi cosa cerchi (affitto o acquisto, tipo di immobile e zona) e ti mostro le opzioni disponibili qui.',
    fr: 'Je ne peux donner que des informations sur DotCasa. Dites-moi ce que vous cherchez (location ou achat, type de bien et quartier) et je vous montre les options disponibles ici.',
    de: 'Ich kann nur Informationen über DotCasa geben. Sag mir, was du suchst (Miete oder Kauf, Objektart und Gegend), und ich zeige dir die verfügbaren Angebote hier.'
  },
  ia: {
    es: 'Soy el asistente de búsqueda de DotCasa y solo puedo ayudarte con propiedades y con información de la plataforma. ¿Qué tipo de inmueble estás buscando y en qué zona?',
    en: "I'm DotCasa's search assistant and can only help with properties and information about the platform. What type of property are you looking for, and where?",
    pt: 'Sou o assistente de busca da DotCasa e só posso ajudar com imóveis e informações da plataforma. Que tipo de imóvel você procura e em qual região?',
    it: "Sono l'assistente di ricerca di DotCasa e posso aiutarti solo con immobili e informazioni sulla piattaforma. Che tipo di immobile cerchi e in quale zona?",
    fr: "Je suis l'assistant de recherche de DotCasa et je ne peux vous aider qu'avec des biens immobiliers et des informations sur la plateforme. Quel type de bien cherchez-vous, et où ?",
    de: 'Ich bin der Suchassistent von DotCasa und kann nur bei Immobilien und Fragen zur Plattform helfen. Welche Art von Immobilie suchst du und wo?'
  },
  capacidades: {
    es: 'Te ayudo a encontrar propiedades en DotCasa. Dime si buscas rentar o comprar, el tipo de inmueble (casa, departamento, terreno, oficina, local, bodega...) y la zona (colonia, ciudad o estado). También puedo filtrar por recámaras, baños, pisos, presupuesto y metros cuadrados de construcción o terreno. Y si tienes dudas sobre DotCasa (planes para publicar, contacto, términos), con gusto te las resuelvo.',
    en: 'I help you find properties on DotCasa. Tell me whether you want to rent or buy, the property type (house, apartment, land, office, retail space, warehouse...) and the area (neighborhood, city or state). I can also filter by bedrooms, bathrooms, floors, budget, and built or land square meters. I can also answer questions about DotCasa (listing plans, contact, terms).',
    pt: 'Ajudo você a encontrar imóveis na DotCasa. Diga se quer alugar ou comprar, o tipo de imóvel (casa, apartamento, terreno, escritório, loja, galpão...) e a região (bairro, cidade ou estado). Também posso filtrar por quartos, banheiros, andares, orçamento e metros quadrados construídos ou de terreno. E tiro dúvidas sobre a DotCasa (planos para anunciar, contato, termos).',
    it: 'Ti aiuto a trovare immobili su DotCasa. Dimmi se vuoi affittare o comprare, il tipo di immobile (casa, appartamento, terreno, ufficio, locale, magazzino...) e la zona (quartiere, città o stato). Posso filtrare anche per camere, bagni, piani, budget e metri quadrati costruiti o di terreno. E rispondo a domande su DotCasa (piani per pubblicare, contatti, termini).',
    fr: 'Je vous aide à trouver des biens sur DotCasa. Dites-moi si vous voulez louer ou acheter, le type de bien (maison, appartement, terrain, bureau, local, entrepôt...) et le secteur (quartier, ville ou État). Je peux aussi filtrer par chambres, salles de bain, étages, budget et mètres carrés construits ou de terrain. Je réponds aussi à vos questions sur DotCasa (offres de publication, contact, conditions).',
    de: 'Ich helfe dir, Immobilien auf DotCasa zu finden. Sag mir, ob du mieten oder kaufen willst, die Objektart (Haus, Wohnung, Grundstück, Büro, Ladenfläche, Lager...) und die Gegend (Viertel, Stadt oder Bundesstaat). Ich kann auch nach Schlafzimmern, Bädern, Etagen, Budget und Wohn- oder Grundstücksfläche filtern. Und ich beantworte Fragen zu DotCasa (Inseratspakete, Kontakt, Bedingungen).'
  },
  muyLargo: {
    es: `Tu mensaje es un poco largo. ¿Me lo resumes en menos de ${MAX_MESSAGE_LENGTH} caracteres? Por ejemplo: "departamento en renta en San Pedro, 2 recámaras, hasta $25,000".`,
    en: `Your message is a bit long. Could you shorten it to under ${MAX_MESSAGE_LENGTH} characters? For example: "2-bedroom apartment for rent in San Pedro, up to $25,000".`,
    pt: `Sua mensagem está um pouco longa. Pode resumir em menos de ${MAX_MESSAGE_LENGTH} caracteres? Por exemplo: "apartamento para alugar em San Pedro, 2 quartos, até $25.000".`,
    it: `Il tuo messaggio è un po' lungo. Puoi riassumerlo in meno di ${MAX_MESSAGE_LENGTH} caratteri? Ad esempio: "appartamento in affitto a San Pedro, 2 camere, fino a $25.000".`,
    fr: `Votre message est un peu long. Pouvez-vous le résumer en moins de ${MAX_MESSAGE_LENGTH} caractères ? Par exemple : « appartement à louer à San Pedro, 2 chambres, jusqu'à 25 000 $ ».`,
    de: `Deine Nachricht ist etwas lang. Kannst du sie auf unter ${MAX_MESSAGE_LENGTH} Zeichen kürzen? Zum Beispiel: „Wohnung zur Miete in San Pedro, 2 Schlafzimmer, bis 25.000 $".`
  }
};

export function getRespuesta(clave, lang = 'es') {
  const textos = TEXTOS[clave] || TEXTOS.fueraDeTema;
  return textos[lang] || textos.es;
}

// Resumen de respaldo cuando se descarta el texto del modelo tras una búsqueda.
export function resumenRespaldo(lang, total) {
  const t = {
    es: total > 0 ? `Encontré ${total} ${total === 1 ? 'propiedad' : 'propiedades'} en DotCasa con tus criterios. ¿Quieres afinar la búsqueda por zona, presupuesto o metros cuadrados?` : 'No encontré propiedades en DotCasa con esos criterios. ¿Probamos con otra zona o ajustando el presupuesto?',
    en: total > 0 ? `I found ${total} ${total === 1 ? 'property' : 'properties'} on DotCasa matching your criteria. Want to narrow it down by area, budget or square meters?` : "I couldn't find properties on DotCasa with those criteria. Shall we try another area or adjust the budget?",
    pt: total > 0 ? `Encontrei ${total} ${total === 1 ? 'imóvel' : 'imóveis'} na DotCasa com os seus critérios. Quer refinar por região, orçamento ou metros quadrados?` : 'Não encontrei imóveis na DotCasa com esses critérios. Vamos tentar outra região ou ajustar o orçamento?',
    it: total > 0 ? `Ho trovato ${total} ${total === 1 ? 'immobile' : 'immobili'} su DotCasa con i tuoi criteri. Vuoi affinare per zona, budget o metri quadrati?` : 'Non ho trovato immobili su DotCasa con questi criteri. Proviamo un\'altra zona o modifichiamo il budget?',
    fr: total > 0 ? `J'ai trouvé ${total} ${total === 1 ? 'bien' : 'biens'} sur DotCasa selon vos critères. Voulez-vous affiner par secteur, budget ou surface ?` : "Je n'ai trouvé aucun bien sur DotCasa avec ces critères. On essaie un autre secteur ou un autre budget ?",
    de: total > 0 ? `Ich habe ${total} ${total === 1 ? 'Immobilie' : 'Immobilien'} auf DotCasa gefunden. Möchtest du nach Gegend, Budget oder Fläche eingrenzen?` : 'Ich habe keine passenden Immobilien auf DotCasa gefunden. Sollen wir eine andere Gegend oder ein anderes Budget probieren?'
  };
  return t[lang] || t.es;
}

// ---------------------------------------------------------------------------
// Chequeos
// ---------------------------------------------------------------------------
const coincide = (texto, patrones) => patrones.some(re => re.test(texto));

export function isDotcasaInfoQuery(message) {
  return coincide(normalizeSearchText(message), INFO_DOTCASA);
}

// La FAQ oficial "¿cómo funciona la búsqueda con IA en DotCasa?" sí se contesta,
// en cualquier idioma, siempre que no pregunte por el modelo en sí.
function esPreguntaIADotcasa(texto) {
  return /\bdotcasa\b/.test(texto)
    && /\b(busqueda|buscador|buscar|funciona|search|works?|busca|pesquisa|ricerca|funziona|recherche|fonctionne|suche|funktioniert)\b/.test(texto)
    && !/\b(chat\s*gpt|gpt|openai|gemini|claude|llm|que modelo|what model|which model|qual modelo|quale modello|quel modele)\b/.test(texto);
}

/**
 * Revisa el mensaje del usuario antes de llamar al modelo.
 * Devuelve { permitido: true, lang } o { permitido: false, categoria, respuesta, lang }.
 */
export function checkUserMessage(message, { tieneIntencionInmobiliaria = false } = {}) {
  const raw = String(message || '');
  const lang = detectLanguage(raw);
  const bloquear = (categoria, clave) => ({ permitido: false, categoria, respuesta: getRespuesta(clave, lang), lang });

  if (raw.length > MAX_MESSAGE_LENGTH) return bloquear('muy_largo', 'muyLargo');
  const t = normalizeSearchText(raw);

  if (coincide(t, INYECCION)) return bloquear('inyeccion', 'fueraDeTema');
  if (coincide(t, COMPETIDORES) || coincide(t, COMPARACION_COMPETENCIA)) return bloquear('competencia', 'competencia');
  if (coincide(t, IA_GENERAL) && !esPreguntaIADotcasa(t)) return bloquear('ia', 'ia');
  if (coincide(t, CODIGO))    return bloquear('codigo', 'fueraDeTema');
  if (coincide(t, LANDING))   return bloquear('landing_page', 'fueraDeTema');
  if (coincide(t, YOUTUBERS)) return bloquear('youtubers', 'fueraDeTema');
  if (coincide(t, MATEMATICAS) || (!tieneIntencionInmobiliaria && EXPRESION_ARITMETICA.test(t))) {
    return bloquear('matematicas', 'fueraDeTema');
  }
  if (coincide(t, CAPACIDADES)) return bloquear('capacidades', 'capacidades');

  return { permitido: true, lang };
}

/**
 * Última red de seguridad sobre la respuesta del modelo: si se le escapó
 * código, un competidor o detalles del modelo, se reemplaza el texto.
 */
export function checkAssistantReply(content) {
  const texto = String(content || '');
  const t = normalizeSearchText(texto);
  const problemas = [];
  if (texto.includes('```') || /<\/?(script|html|div|body)\b/i.test(texto)) problemas.push('codigo');
  if (coincide(t, COMPETIDORES)) problemas.push('competencia');
  if (/\b(chat\s*gpt|gpt-?\d|openai|gemini|claude|anthropic|modelo de (lenguaje|linguagem)|language model|modello linguistico|modele de langage|sprachmodell)\b/.test(t)) {
    problemas.push('ia');
  }
  return { seguro: problemas.length === 0, problemas };
}
