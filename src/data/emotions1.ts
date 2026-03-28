import { createDeckFromRaw } from "./deckBuilder";

const rawEmotions1Parts = [
  `
Emotions-mental and physiological states that arise in response to stimuli and involve feelings, thoughts, and bodily reactions
Limbic system-a group of brain structures involved in emotion, motivation, memory, and emotional regulation
Affective science-an interdisciplinary field that studies emotions, moods, and feelings and their psychological and biological bases
Animal emotions-the study of emotional experiences and expressions in nonhuman animals
Criminal psychology-the branch of psychology that examines the thoughts, emotions, and behaviors of criminals
Crying-the act of shedding tears, often as an expression of emotion such as sadness, relief, or joy
Emotion psychologists-psychologists who specialize in researching and understanding emotional processes
Emotional intelligence-the ability to recognize, understand, manage, and use emotions effectively in oneself and others
Emotional issues-psychological difficulties related to experiencing, expressing, or regulating emotions
Feeling-the subjective experience of emotion or sensation as consciously perceived
Humour-the quality of being amusing or the ability to perceive and express what is funny
Laughter-a vocal expression of amusement, joy, or social bonding
Lyric poets-poets who express personal emotions and inner experiences through lyrical poetry
Mood disorders-mental health conditions characterized by persistent disturbances in emotional state
Motivation-the internal and external forces that initiate, direct, and sustain behavior toward goals
Sociology of emotions-the study of how emotions are shaped by social structures, norms, and interactions
Stress (biological and psychological)-a state of mental or physical strain resulting from demanding or threatening situations
Emotion-a complex psychological state involving subjective experience, physiological response, and expressive behavior
Emotion regime-a socially enforced set of norms governing how emotions should be expressed and managed
Emotive (sociology)-the role of emotional expression as a social act that shapes relationships and structures
History of emotions-the study of how emotional experiences and expressions change across historical periods
Sociology of emotions-the examination of emotions as shaped by social norms, institutions, and interactions
Vocabulary of emotions-the set of words and concepts used to describe emotional experiences
Abandonment (emotional)-the distress or fear associated with being left or rejected by significant others
Aesthetic emotions-emotions evoked by art, beauty, or sensory experiences such as awe or wonder
Affect consciousness-the capacity to perceive, tolerate, reflect on, and express emotional states
Affect display-the outward expression of emotion through facial expression, posture, or behavior
Affect in education-the influence of emotions on learning, teaching, and academic engagement
Affect infusion model-a theory explaining how mood influences judgment and decision-making
Affect measures-tools or methods used to assess emotional states or affective responses
Affective events theory-a framework describing how workplace events trigger emotional reactions that influence behavior
Affective haptics-the study and design of touch-based technologies that convey or evoke emotions
Affective neuroscience-the study of neural mechanisms underlying emotion and affect
Amusement-a feeling of pleasure or enjoyment often accompanied by laughter or smiles
Anthropopathism-the attribution of human emotions or feelings to nonhuman entities
Art and emotion-the relationship between artistic expression and emotional experience
Artificial empathy-the simulation or modeling of empathic responses by artificial systems
Blushing-a physiological response involving facial reddening due to emotional arousal
Bounded emotionality-the concept that emotional expression is limited by social or organizational norms
Butterflies in the stomach-a sensation of nervous excitement felt in the abdomen
Catharsis-the emotional release or relief gained through expression of strong feelings
Cognitive bias in animals-the influence of emotional states on animals' perception and decision-making
Collapse of compassion-a reduction in empathic response when faced with large-scale suffering
Compassion fatigue-emotional exhaustion resulting from prolonged exposure to others' distress
Condensation symbol-an object or phrase that evokes complex emotional meanings
Conditioned emotional response-an emotional reaction learned through association with a stimulus
Connectedness to nature scale-a psychological measure assessing emotional closeness to the natural world
Crying-the act of shedding tears as an emotional response
Discrete emotion theory-the view that emotions are distinct, biologically based categories
Elevation (emotion)-a warm, uplifting feeling experienced when witnessing moral goodness
EmojiGrid-a visual tool for reporting emotional responses using emoji representations
Emotion and memory-the interaction between emotional states and memory formation or recall
Emotion classification-the systematic grouping of emotions into categories or dimensions
Emotion perception-the ability to identify emotions in oneself or others
Emotion recognition-the process of correctly identifying emotional expressions
Emotion recognition in conversation-the detection of emotions during spoken or written interaction
Emotion Review-an academic journal focusing on emotion research
Emotion work-the effort to manage and regulate emotions to meet social expectations
Emotional abuse-patterns of behavior that harm another's emotional well-being
Emotional affair-a relationship involving emotional intimacy outside a primary partnership
Emotional affect-the immediate emotional tone or feeling state
Emotional aperture-the ability to perceive the emotional composition of a group
Emotional approach coping-coping strategies that involve processing and expressing emotions
Emotional argument-an argument driven primarily by emotional appeal rather than logic
Emotional baggage-unresolved emotional experiences carried into new situations or relationships
Emotional bias-the influence of emotions on judgment or decision-making
Emotional blunting-reduced intensity or range of emotional experience
Emotional conflict-a state in which opposing emotions are experienced simultaneously
Emotional detachment-a distancing from emotional involvement or expression
`,
  `
Emotion-a complex psychological state involving subjective experience, physiological response, and expressive behavior
Emotion regime-a socially enforced system of norms governing which emotions are acceptable and how they should be expressed
Emotive (sociology)-emotional expressions viewed as social acts that shape meaning and relationships
History of emotions-the study of how emotions are understood, experienced, and expressed across different historical periods
Sociology of emotions-the study of emotions as products of social interaction, norms, and institutions
Vocabulary of emotions-the collection of words and concepts used to describe emotional experiences
Abandonment (emotional)-feelings of distress, fear, or insecurity caused by perceived or actual rejection
Aesthetic emotions-emotions evoked by art, beauty, or sensory appreciation
Affect consciousness-the ability to notice, understand, tolerate, and express emotions
Affect display-the outward expression of emotion through facial, vocal, or bodily cues
Affect in education-the role emotions play in learning, teaching, and academic performance
Affect infusion model-a theory explaining how emotions influence judgment and decision-making
Affect measures-tools or methods used to assess emotional states or responses
Affective events theory-a theory describing how specific events trigger emotions that influence behavior
Affective haptics-the study of using touch-based technology to communicate or evoke emotion
Affective neuroscience-the scientific study of the brain mechanisms underlying emotion
Amusement-a pleasant emotional state involving enjoyment or lighthearted pleasure
Anthropopathism-the attribution of human emotions to nonhuman entities
Art and emotion-the relationship between artistic expression and emotional experience
Artificial empathy-the simulation of empathic responses by machines or artificial systems
Blushing-an involuntary reddening of the face caused by emotional arousal
Bounded emotionality-the idea that emotional expression is constrained by social or organizational limits
Butterflies in the stomach-a physical sensation of nervous excitement or anticipation
Catharsis-the release of emotional tension through expression or experience
Cognitive bias in animals-the influence of emotional states on animals' perception and decisions
Collapse of compassion-a decrease in empathic response when confronted with large-scale suffering
Compassion fatigue-emotional exhaustion from prolonged exposure to others' distress
Condensation symbol-a symbol that evokes multiple complex emotions or meanings
Conditioned emotional response-an emotional reaction learned through repeated association
Connectedness to nature scale-a measure of emotional connection to the natural environment
Crying-the shedding of tears as an emotional response
Discrete emotion theory-the theory that emotions are biologically distinct and universal
Elevation (emotion)-a warm, uplifting feeling inspired by witnessing moral goodness
EmojiGrid-a visual tool for reporting emotions using emoji-based scales
Emotion and memory-the interaction between emotional states and memory processes
Emotion classification-the systematic categorization of emotions
Emotion perception-the ability to identify emotions in oneself or others
Emotion recognition-the process of identifying emotional expressions
Emotion recognition in conversation-detecting emotions during spoken or written interaction
Emotion Review-an academic journal focused on emotion research
Emotion work-the effort to manage emotions to meet social expectations
Emotional abuse-patterns of behavior that harm another person's emotional well-being
Emotional affair-a relationship involving deep emotional intimacy outside a primary partnership
Emotional affect-the immediate feeling tone of an emotional state
Emotional aperture-the ability to perceive the emotional composition of groups
Emotional approach coping-coping strategies focused on processing and expressing emotions
Emotional argument-persuasion based primarily on emotional appeal
Emotional baggage-unresolved emotional experiences carried into new situations
Emotional bias-the influence of emotions on judgment or decision-making
Emotional blunting-reduced intensity or range of emotional experience
Emotional conflict-the experience of opposing emotions at the same time
Emotional detachment-withdrawal from emotional involvement or expression
Emotional expression-the verbal and nonverbal communication of emotion
Emotional Freedom Techniques-a therapeutic method combining tapping with cognitive focus
Emotional granularity-the ability to identify and describe emotions precisely
Emotional hangover-lingering emotional effects after an intense experience
Emotional health-the ability to understand, manage, and express emotions effectively
Emotional interest-a feeling of emotional engagement or curiosity toward someone or something
Emotional intimacy-close emotional connection involving trust and vulnerability
Emotional labor-the management of emotions to fulfill social or job roles
Emotional lateralization-the specialization of emotional processing in one brain hemisphere
Emotional manipulation-the use of emotions to influence or control others
Emotional or behavioral disability-a condition affecting emotional regulation or behavior
Emotional prosody-the expression of emotion through tone, pitch, and rhythm of speech
Emotional resilience-the ability to recover from emotional stress or adversity
Emotional responsivity-the degree to which someone reacts emotionally to stimuli
Emotional selection (dreaming)-the idea that emotions influence which experiences appear in dreams
Emotional selection (evolution)-the role emotions play in evolutionary adaptation
Emotional selection (information)-the tendency to prioritize emotionally relevant information
Emotional support-care or reassurance that provides emotional comfort
Emotional thought method-a technique using emotion-focused thinking to influence beliefs
Emotional vampire-a person who drains others emotionally
Emotionality-the tendency to experience and express emotions
Emotionally focused therapy-a therapeutic approach centered on emotional bonds and attachment
Emotions Anonymous-a support group for people struggling with emotional difficulties
Emotions in decision-making-the influence of emotions on choices and judgments
Emotions in the workplace-the role of emotions in professional environments
Emotions in virtual communication-how emotions are expressed and perceived digitally
Emotivism-the theory that moral statements express emotions rather than facts
Empathic accuracy-the ability to correctly infer others' emotions
Empathic concern-feelings of compassion and care for others
Empathy in autistic people-the experience and expression of empathy in autistic individuals
Escapism-the tendency to seek distraction from reality or emotional stress
Evolution of emotion-the development of emotions through evolutionary processes
Expressive suppression-the inhibition of outward emotional expression
Facebook emotional manipulation experiment-a study examining emotional contagion via social media
Facial coding-the systematic analysis of facial movements to identify emotions
Facial expression-the use of facial movements to communicate emotion
Feeling-the conscious subjective experience of emotion or sensation
Friendship jealousy-jealousy arising within platonic relationships
Functional accounts of emotion-theories explaining emotions by their adaptive purpose
Gender and emotional expression-differences in emotional expression across genders
Group affective tone-the shared emotional atmosphere of a group
Group emotion-emotions experienced collectively by groups
Heartistic-an artistic style emphasizing emotional sincerity over realism
Homeostatic feeling-internal sensations that signal bodily balance or imbalance
Hot-cold empathy gap-the difficulty of predicting behavior across emotional states
Hygge-a feeling of comfort, warmth, and contentment
Interactions between the emotional and executive brain systems-the coordination between emotion and cognitive control
International Affective Picture System-a standardized database of images used to study emotion
James-Lange theory-the theory that emotions arise from perception of bodily changes
Kinesthetic sympathy-emotional understanding through physical or bodily sensation
Laughter-a vocal expression of amusement or social bonding
Literalism (music)-an approach to music interpretation that emphasizes direct emotional or narrative meaning without abstraction
Long arm of childhood-the lasting emotional influence of early life experiences on adulthood
Lovesickness-a state of emotional distress caused by unreturned or troubled love
Lovestruck-an intense feeling of being emotionally overwhelmed by romantic attraction
Lovheim Cube of Emotions-a neurochemical model mapping emotions to levels of dopamine, serotonin, and noradrenaline
Mal du siecle-a feeling of existential melancholy or disillusionment associated with a generation
Measures of conditioned emotional response-methods used to assess learned emotional reactions to stimuli
Measures of guilt and shame-tools designed to assess experiences of guilt and shame
Microexpression-a very brief, involuntary facial expression revealing genuine emotion
Moral emotions-emotions related to moral judgments, such as guilt, shame, or pride
Music and emotion-the study of how music evokes, expresses, or regulates emotions
`,
  `
Negative affectivity-a tendency to experience negative emotions frequently and intensely
Neglect-the emotional or physical failure to provide necessary care or attention
Neuroticism-a personality trait characterized by emotional instability and negative emotions
Non-Instrumental Movement Inhibition-the suppression of movement due to emotional or cognitive factors
PAD emotional state model-a framework describing emotions along pleasure, arousal, and dominance dimensions
Passions of the Soul-a philosophical work by Descartes examining human emotions
Pathos-the quality of evoking pity, sadness, or emotional depth
PERMA model-a model of well-being including positive emotion, engagement, relationships, meaning, and accomplishment
Personal distress-self-focused discomfort felt when witnessing others' suffering
Positive and Negative Affect Schedule-a psychological scale measuring positive and negative emotional states
Psychological pain-intense emotional suffering not caused by physical injury
Qing (philosophy)-a concept in Chinese philosophy referring to emotion or feeling
Co-regulation-the process of managing emotions through interaction with others
Emotional dysregulation-difficulty managing emotional responses appropriately
Interpersonal emotion regulation-the influence of others on one's emotional state
Emotional self-regulation-the ability to manage and modify one's own emotions
Ressentiment (book)-a philosophical work by Nietzsche analyzing suppressed resentment and moral emotions
Self-conscious emotions-emotions involving self-evaluation, such as shame, pride, or embarrassment
Sensibility-heightened emotional responsiveness or sensitivity
Sleep and emotions-the relationship between sleep patterns and emotional regulation
Social connection-the emotional bond or sense of belonging with others
Social emotional development-the development of emotional understanding and social skills
Social sharing of emotions-the communication of emotional experiences with others
Somatic marker hypothesis-the theory that bodily signals guide emotional decision-making
Somatic theory-the view that emotions arise from bodily sensations
Stiff upper lip-the cultural norm of suppressing emotional expression
Stimulation-the level of emotional or physiological arousal
Stoic passions-emotions viewed by Stoic philosophy as disturbances to be controlled
Subtle expression-minimal or restrained outward display of emotion
Tantrum-an intense emotional outburst, often involving anger or frustration
Theory of constructed emotion-the theory that emotions are constructed from core affect and context
Two-factor theory of emotion-the idea that emotion results from physiological arousal plus cognitive interpretation
Voodoo death-a phenomenon where belief-induced fear leads to physical collapse or death
We Feel Fine-a project visualizing global emotional expression from online text
Wild man syndrome-a psychological state involving emotional disinhibition and aggressive behavior
`,
];

export const emotions1Deck = createDeckFromRaw({
  id: "emotions1",
  title: "emotions1",
  subtitle: "An emotion-focused Wikipedia deck covering theory, behavior, and emotional life.",
  raw: rawEmotions1Parts.join("\n"),
  protectedTerms: [
    "Co-regulation",
    "Emotional self-regulation",
    "Emotions in decision-making",
    "Hot-cold empathy gap",
    "James-Lange theory",
    "Non-Instrumental Movement Inhibition",
    "Self-conscious emotions",
  ],
});
