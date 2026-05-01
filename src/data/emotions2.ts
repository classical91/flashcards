import { createDeckFromRaw } from "./deckBuilder";

const rawEmotions2 = `
Affection-a gentle feeling of fondness, care, or warmth toward someone
Anxiety-a state of unease, worry, or nervous anticipation about possible threats or uncertainty
Courage-the ability to face fear, pain, or difficulty with resolve and bravery
Depression (mood)-a prolonged state of low mood marked by sadness, emptiness, or loss of interest
Doubt-uncertainty or lack of conviction about something being true or reliable
Empathy-the capacity to understand and share the feelings of another
Fear-an emotional response to perceived danger or threat, involving alertness or avoidance
Gratitude-a feeling of thankfulness and appreciation for benefits received
Grief-deep sorrow and emotional pain caused by loss, especially the death of someone
Guilt-a feeling of responsibility or remorse for a perceived wrongdoing
Happiness-a state of well-being characterized by joy, contentment, or satisfaction
Hatred-intense dislike or hostility toward someone or something
Hope-a feeling of expectation and desire for a positive outcome
Humiliation-a painful loss of dignity or self-respect caused by embarrassment or shame
Hysteria-an exaggerated or uncontrolled display of emotion, often fear or excitement
Interpersonal attraction-the psychological pull or interest one person feels toward another
Jealousy-an emotional reaction to the fear of losing something valued to a rival
Kindness-the quality of being friendly, generous, and considerate toward others
Love-a deep feeling of affection, attachment, and care for someone or something
Melancholia-a subdued, reflective sadness often tinged with thoughtfulness
Nostalgia-a sentimental longing for the past, often idealized
Pessimism-a tendency to expect negative outcomes or focus on unfavorable aspects
Pride-a sense of satisfaction or self-respect arising from achievements or qualities
Rage (emotion)-intense, explosive anger that can overwhelm self-control
Romance-a focus on love, emotional intimacy, and affectionate expression
Seduction-the act of enticing someone through charm, attraction, or persuasion
Sexual emotions-feelings related to sexual desire, arousal, or intimacy
Shame-a painful feeling arising from the belief of having failed or violated standards
Silliness-lighthearted or playful behavior that lacks seriousness
Social emotions-feelings that arise from interactions with others and social evaluation
Suffering-the experience of physical or emotional pain, distress, or hardship
Acceptance-the state of acknowledging reality or feelings without resistance
Acedia-a condition of apathy, listlessness, or spiritual/emotional exhaustion
Adoration-deep love, reverence, or admiration
Affect labeling-the act of identifying and naming one's emotions
Affect regulation-the ability to manage and respond to emotional experiences
Affection-gentle feelings of fondness, warmth, or care
Ambivalence-the experience of having conflicting emotions simultaneously
Anger-a strong emotional response to perceived injustice or threat
Angst-a deep feeling of anxiety or existential dread
Anguish-intense emotional pain or suffering
Annoyance-a mild form of irritation or displeasure
Anticipation-a feeling of expectancy or excitement about what is to come
Antipathy-a strong feeling of dislike or aversion
Anxiety-a state of worry or unease about uncertain outcomes
Apathy-lack of interest, concern, or emotional engagement
Arousal-a state of emotional or physiological activation
Aversion to happiness-discomfort or avoidance of happiness due to fear or beliefs about its consequences
Awe-a feeling of wonder and reverence inspired by something vast or powerful
Boredom-a state of dissatisfaction caused by lack of stimulation or interest
Broken heart-deep emotional pain caused by loss, rejection, or separation
Calmness-a state of emotional tranquility and inner peace
Complaining-the expression of dissatisfaction or discontent
Condescension-an attitude of superiority expressed through patronizing behavior
Confidence-a feeling of self-assurance and trust in one's abilities
Confusion-a lack of clarity or understanding
Contempt-a feeling of disdain or disrespect toward someone
Contentment-a quiet sense of satisfaction and fulfillment
Continuing bonds-the maintenance of emotional connection after loss
Contrition-remorse and guilt accompanied by a desire to make amends
Courage-the capacity to face fear or adversity with resolve
Creepiness-a feeling of unease caused by something unsettling or abnormal
Cute aggression-an urge to squeeze or act roughly toward something perceived as very cute
Defeatism-the belief that failure is inevitable
Depression (mood)-a prolonged state of sadness, low energy, and loss of interest
Desire-a strong feeling of wanting or longing
Despair-the complete loss of hope
Differential Emotions Scale-a framework for identifying and measuring distinct emotions
Disappointment-sadness resulting from unmet expectations
Disgust-a strong feeling of revulsion or rejection
Disorders of diminished motivation-conditions marked by reduced drive or initiative
Dysphoria-a state of emotional discomfort or dissatisfaction
Ecstasy (emotion)-an overwhelming feeling of intense joy or bliss
Ecstatic seizures-episodes involving altered consciousness and intense emotional states
Embarrassment-self-conscious discomfort caused by social missteps
Emotional origins of music-the idea that music arises from emotional expression
Empathy-the ability to understand and share another's feelings
Emptiness-a sense of inner void or emotional numbness
Enthusiasm-lively excitement and eager interest
Envy-a feeling of resentment toward another's advantages
Escapism-avoidance of reality through distraction or fantasy
Euphoria-an intense state of happiness or well-being
Exhilaration-a feeling of energized joy and uplift
Fear-an emotional response to perceived danger or threat
Fonnker-a Reunion Creole term describing deep emotional longing or heartfelt feeling
Frustration-irritation caused by blocked goals or unmet needs
Gloom-a state of sadness or emotional darkness
Gratitude-a feeling of thankfulness and appreciation
Grief-deep sorrow caused by loss
Guilt (emotion)-distress arising from perceived wrongdoing
Happiness-a state of well-being and positive emotion
Hatred-intense and persistent dislike or hostility
Homesickness-longing for one's home or familiar environment
Hope-expectation and desire for a positive outcome
Hostility-aggressive or unfriendly emotional attitude
Humiliation-painful loss of dignity or self-respect
Hysteria-an exaggerated or uncontrollable emotional reaction
Indignation-anger provoked by perceived injustice or unfairness
Infatuation-intense but often short-lived romantic attraction
Insecurity (emotion)-feelings of uncertainty and self-doubt
Insignificance-a feeling of being unimportant or negligible
Insult-a feeling of offense or humiliation caused by disrespect
Interest (emotion)-curiosity or focused attention toward something
Invidia-envy marked by resentment at another's success
Irritability-proneness to anger or annoyance
Isolation (psychology)-emotional or social separation from others
Jealousy-fear of losing a valued relationship to a rival
Joy-a feeling of great pleasure or happiness
Kama muta-a feeling of being emotionally moved by sudden closeness or love
Kindness-the quality of being caring, generous, and considerate
Limerence-an intense, obsessive form of romantic longing
Loneliness-distress caused by perceived social isolation
Loyalty-strong feelings of allegiance and commitment
Lust-intense sexual desire
Malaise-a general feeling of discomfort or unease
Melancholia-a reflective, subdued form of sadness
Mimpathy-the enjoyment of another's misfortune
Mono no aware-awareness of impermanence accompanied by gentle sadness
Mudita-joy felt in response to another's happiness
Museum fatigue-mental and emotional exhaustion from prolonged viewing or stimulation
Nostalgia-sentimental longing for the past
Outrage (emotion)-intense anger in response to moral violation
Panic-sudden overwhelming fear with physical symptoms
Parental love-deep, protective affection toward one's child
Passion (emotion)-intense emotional or romantic feeling
Passionate and companionate love-the combination of desire-driven and deep affectionate love
Pathological jealousy-an extreme, irrational form of jealousy disconnected from reality
Patience-the capacity to tolerate delay or difficulty without frustration
Penis size envy-feelings of insecurity or inadequacy arising from comparison of one's penis size to others
Pessimism-a tendency to expect negative outcomes
Pity-sorrow or compassion felt for another's suffering
Pleasure-a feeling of enjoyment, satisfaction, or gratification
Pride-a sense of satisfaction or self-respect based on achievements or identity
Emotional promiscuity-a pattern of rapidly forming intense emotional attachments without deep commitment
Quixotism-idealistic pursuit of unrealistic or impractical goals
Rage (emotion)-intense and overwhelming anger
Reasonable person model-a psychological or legal standard based on how an average person would think or act
Regret-distress or sadness over past actions or missed opportunities
Relaxation (psychology)-a state of reduced tension and calm
Relief (emotion)-comfort or ease following the removal of stress or fear
Remorse-deep guilt and sorrow over causing harm
Resentment-lingering anger from perceived unfairness or injury
Reverence (emotion)-deep respect or awe
Ridiculous-a feeling that something is absurd or laughable
Romance-emotional expression of love, affection, or intimacy
Runner's high-euphoric feeling following prolonged physical exercise
Sadness-a feeling of unhappiness or emotional pain
Saudade-deep nostalgic longing for something absent or lost
Sehnsucht-intense yearning for an idealized or distant longing
Self-pity-excessive focus on one's own suffering
Sense of wonder-feeling of amazement or curiosity toward something extraordinary
Sentimentality-tender or nostalgic emotional softness
Seriousness-a focused, sincere, or solemn emotional state
Shame-painful feeling of self-disapproval or dishonor
Acute stress reaction-intense short-term emotional and physical response to trauma
Shyness-discomfort or nervousness in social situations
Silliness-playful or unserious behavior
Sincerity-genuine and honest emotional expression
Social alienation-feeling of disconnection from society or others
Solitude-state of being alone, often voluntarily
Sorrow (emotion)-deep sadness or grief
Spite (sentiment)-desire to hurt or annoy someone out of bitterness
Subjective well-being-personal evaluation of life satisfaction and emotional state
Surprise (emotion)-sudden reaction to unexpected events
Suspense-feeling of tension or anxious anticipation
Suspicion (emotion)-doubt or mistrust of others' intentions
Sympathy-feeling of care or concern for another's suffering
The ick-sudden feeling of romantic or physical aversion toward someone
Trust (social science)-confidence in the reliability or integrity of others
Unipolar emotions-emotions experienced along a single dimension rather than opposing pairs
Valence (psychology)-the positive or negative quality of an emotional experience
Vicarious embarrassment-embarrassment felt on behalf of someone else
Won (injustice)-anger or distress caused by perceived unfair treatment
Wonder (emotion)-feeling of amazement or curiosity
Worry-anxious thinking about potential problems
Zest (positive psychology)-enthusiastic energy and eagerness for life
`;

export const emotions2Deck = createDeckFromRaw({
  id: "emotions2",
  title: "emotions2",
  raw: rawEmotions2,
});
