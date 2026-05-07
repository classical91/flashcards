import { createDeckFromRaw } from "./deckBuilder";

const rawPositiveAdjectives = `
adaptable-able to adjust easily to new situations
admirable-deserving respect or approval
adorable-extremely cute or charming
adroit-skillful and clever
advanced-highly developed or progressive
affable-friendly and easy to talk to
agreeable-pleasant and likable
alert-quick to notice and respond
altruistic-selflessly concerned for others
amazing-causing great surprise or wonder
ambitious-having strong goals and determination
amiable-warm and friendly
amicable-showing polite friendliness
animated-full of energy and life
ardent-passionate and enthusiastic
articulate-able to express ideas clearly
artistic-creative and imaginative
aspiring-striving for success or achievement
astonishing-impressively surprising
astute-smart and perceptive
attractive-pleasing in appearance or character
audacious-boldly confident
authentic-genuine and true
balanced-steady and well-composed
beautiful-pleasing to the senses or mind
beloved-deeply loved
benevolent-kind and generous
blissful-full of joy
bold-confident and courageous
brave-showing courage
bright-intelligent and cheerful
brilliant-exceptionally clever
bubbly-cheerful and full of energy
calm-peaceful and composed
capable-able to do things well
carefree-free from worry
careful-thoughtful and cautious
caring-kind and compassionate
charismatic-charming and inspiring
charitable-generous and helpful
cheerful-noticeably happy
chivalrous-courteous and honorable
clever-quick-minded
commendable-worthy of praise
compassionate-showing concern for others
competent-capable and efficient
confident-self-assured
conscientious-careful and responsible
considerate-thoughtful of others
consistent-reliable and steady
constructive-helpful and positive
content-satisfied and at ease
convincing-persuasive and effective
coolheaded-calm under pressure
cooperative-willing to work with others
courageous-brave and determined
courteous-polite and respectful
creative-imaginative and inventive
credible-believable and trustworthy
cultured-refined and well-educated
cute-charmingly attractive
daring-bold and adventurous
dazzling-extremely impressive
decent-honest and good
decisive-able to make clear decisions
dedicated-committed and loyal
deep-thoughtful and insightful
deliberate-careful and purposeful
delightful-highly pleasing
dependable-reliable
deserving-worthy of reward
determined-resolute and persistent
devoted-deeply committed
dignified-calm,noble,and respectful
diligent-hardworking and careful
diplomatic-tactful and fair
disciplined-self-controlled
discerning-showing good judgment
distinctive-unique and notable
distinguished-admired and respected
dynamic-energetic and forceful
eager-enthusiastic
earnest-sincere and serious
easygoing-relaxed and pleasant
ebullient-cheerful and full of energy
educated-knowledgeable
efficient-productive with minimal waste
elegant-graceful and stylish
eloquent-fluent and persuasive
empathetic-able to understand feelings
encouraging-giving support or confidence
endearing-inspiring affection
energetic-full of energy
engaging-interesting and charismatic
enlightened-wise and spiritually aware
enterprising-resourceful and bold
entertaining-enjoyable and amusing
enthusiastic-full of excitement
ethical-morally good
excellent-extremely good
exceptional-unusually outstanding
exciting-causing excitement
exemplary-serving as a perfect example
experienced-knowledgeable through practice
expert-highly skilled
extraordinary-remarkable
exuberant-lively and joyful
fabulous-extremely good
fair-just and reasonable
faithful-loyal and dependable
famous-widely known
fantastic-amazingly good
fascinating-very interesting
fashionable-stylish
fearless-unafraid
feisty-lively and courageous
fervent-passionate
fiery-energetic and intense
fine-of high quality
flexible-able to bend or adapt
focused-concentrated and attentive
forgiving-willing to let go of mistakes
fortunate-lucky
friendly-kind and pleasant
frugal-careful with resources
fun-enjoyable
funny-causing laughter
gallant-brave and noble
generous-giving and kind
genial-friendly and cheerful
gentle-kind and soft
genuine-real and sincere
gifted-exceptionally talented
giving-generous and selfless
glamorous-full of charm and beauty
gleeful-full of joy
glorious-magnificent
glowing-warm and positive
goodhearted-kind and caring
gracious-polite and courteous
grateful-thankful
great-excellent
gregarious-sociable and outgoing
grounded-stable and sensible
handsome-good-looking
hardworking-diligent
harmonious-balanced and peaceful
hearty-warm and enthusiastic
helpful-giving assistance
heroic-brave and noble
high-minded-morally elevated
honest-truthful
honorable-deserving respect
hopeful-full of optimism
hospitable-welcoming
humane-compassionate
humble-modest and respectful
humorous-funny
idealistic-guided by high principles
imaginative-creative
immaculate-perfectly clean or flawless
immense-extremely large or great
impartial-fair and unbiased
impeccable-flawless
impressive-admirable
improving
`;

export const positiveAdjectivesDeck = createDeckFromRaw({
  id: "positive-adjectives",
  title: "Positive Adjectives",
  raw: rawPositiveAdjectives,
  protectedTerms: ["high-minded"],
  fallbackDefinitions: {
    improving: "getting better over time",
  },
});
