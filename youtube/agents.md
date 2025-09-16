Project use Java 8. No use of NodeJS or Python at all.





# Tests

Rule of thumb: More tests - better.

Rules for testing:
- All features should have a unit test or tests.
- Should be used JUnit with matchers from Hamcrest library.
- Should be used Mockito library when needed.

Each test method should have 3-4 sections, each section devided by commont line and empty line:
- Initialization - use `final` keyword to hardcode constants that will be used in test.
- Mocks - Crete mocks with Mockito library. This section is optional.
- Execution - Execute test
- Assertion - Do assertion with Hamcrest library.

Example:

    @Test
    public void parseDecodesRedirectLinks() {
        // Initialization.
        final String expectedTwitter = "https://twitter.com/StephenJohnPeel";
        final String expectedOther = "https://example.com";
        final String html = "<div id='links-section'"
                + "><a class='yt-core-attributed-string__link' href='https://www.youtube.com/redirect?event=channel_description&redir_token=token&q=https%3A%2F%2Ftwitter.com%2FStephenJohnPeel'></a>"
                + "<a class='yt-core-attributed-string__link' href='https://www.youtube.com/redirect?event=channel_description&redir_token=token&q=https%3A%2F%2Fexample.com'></a>"
                + "</div>";
        
        // Execution.
        Parser parser = new Parser();
        ChannelAbout channel = parser.parse("https://www.youtube.com/@some/about", html);
        
        // Assertion.
        assertThat(channel.getLinkToTwitter(), is(expectedTwitter));
        assertThat(channel.getOtherLinks(), is(expectedOther));
    }





# Manage dependencies

In case to write code to fullfil a task it requires to add new dependency that is not present in the `pom.xml` file then just fail to do this task and let me know that new dependency should be added to the project. 





# GIT commits format

The first line in commit is short description of the commit.

Then should be empty line.

Then should be full description what and why was done. Put notes about the task that you solved and how it was soved. Put any notes that you have in mind.





# Java code

### Do not use some Java 8 features

Do not use:
- Class java.util.Optional
- Interface default methods
- Lambdas
- Streams



### Use assert keyword

Assert should be used to catch bugs in code on early stage.

Use assert with a message and current value, example: assert x < 0 : "x must be negative! Got: " + x;

Objects.requireNonNull method should be used over assert keyword to check that method parameters are not NULL. All paramaters of public methods should be checked.



### Handle NULLs

Do not use java.util.Optional class.

Collections are never null, do initialization like: List<String> names = new ArrayList<>();

Enums should have option like "UNKNOWN" that used instead of NULL.

Basic objects should be initialized with "empty" values, for example:
- String name = "";
- Integer age = 0;



### Immutable objects

Method parameters should have "final" modification in most cases.





# Web

### JavaScript code

It's web application, not NodeJS and there shouldn't be used npm command/packages.

JavaScript should not use modules like this <script type="module"> or "import" keywords.



### JavaScript tests

Use qunit library to create tests for JavaScript functions.

Create a webpage to run tests, so I can run it from web browser. I do not won't to install any npm packages.



### HTML pages hearders

Use following header for pages:

<!DOCTYPE html>
<html lang="en">
    <head>
        <title>JavaScript documentation</title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />

        <!-- Bootstrap / JQuery / Knockout. -->
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@4.6.2/dist/css/bootstrap.min.css" integrity="sha384-xOolHFLEh07PJGoPkLv1IbcEPTNtaed2xpHsD9ESMhqIYd0nLMwNLD69Npy4HI+N" crossorigin="anonymous" />
        <script src="https://code.jquery.com/jquery-3.5.1.min.js" integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0=" crossorigin="anonymous"></script>
        <script src="https://cdn.jsdelivr.net/npm/popper.js@1.16.1/dist/umd/popper.min.js" integrity="sha384-9/reFTGAW83EW2RDu2S0VKaIzap3H66lZH81PoYlFhbGU+6BZp6G7niu735Sk7lN" crossorigin="anonymous"></script>
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@4.6.2/dist/js/bootstrap.min.js" integrity="sha384-+sLIOodYLS7CIrQpBjl+C7nPvqq+FbNUBDunl/OZv93DB7Ln/533i8e/mZXLi/P+" crossorigin="anonymous"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/knockout/3.5.0/knockout-min.js"></script>
    </head>
    <body class="container mt-3">



### JavaScript/CSS libraries

Apply Bootstrap classes to form elements and other page elements. Use custom CSS only when necessary.

Use knockout to bind javascript functionality to web forms.





# Java code layout for internal API and external API

External API is an API provided by Java library/application (.jar file dependency). Even if you are build an application then main functionality should be available for other as if it a library.

Definition and Scope
- __External API:__ Public-facing contracts meant for consumers of your library or module. Must remain stable, backward-compatible, and well-documented.
- __Internal API:__ Used only within the project/application. Can evolve freely as long as internal consumers are adapted.

Use of Interfaces/Abstract classes:
- Use Interfaces to build external API.
- Use Abstract classes to build internal API.

Use of packages/nested-inner classes for code layouts:
- Use packages to build external API code layout.
- Use nested/inner classes to build internal API code layout.

API interfaces and nested/inner classes of implementation should be stored in the same package.

Visibility scopes:
- Use public only for external API.
- Use protected/package-private/private for internal API elements.





# Java OOP design / SOLID principles

SOLID principles should be applied to build high quality of OOP design.



### __SRP__: Single responsibility principle

Rule: __A class should only have one responsibility. Furthermore, it should only have one reason to change.__

When apply classical objects (real-world modeling):
- For domain entities that represent real-worrld concepts: User, Car, Invoice, etc.
- These classes can contain both data + behavior that make sense together.
- Good for core business logic: invoice.calculateTotal(), car.startEngine(), etc.

When apply SRP:
- For infrastructure or cross cutting tasks:
	- Persistance -> UserRepository
	- Communication -> EmailService
	- Presentation -> ReportPrinter
	- Validation -> UserValidator
- Each such class focuses on one concern, even if it has multiple methods.
- Helps with testability, maintability, and swapping implementations.

Balance rule of thumb:
- __Domain layer__ -> classic OOP (objcets mirror reality).
- __Service/utility layers__ -> SRP (classes have one responsibility, not mixed).



### __OCP__: Open/closed principle

Rule: __Classes should be open for extension but closed for modification. In doing so, we stop ourselves from modifying existing code and causing potential new bugs.__ Of course, the one exception to the rule is when fixing bugs in existing code.



### __LSP__: Liskov substitution principle

Rule: __If class A is a subtype of class B, we should be able to replace B with A without disrupting the behavior of our program.__

All the time we design a program module and we create some class hierarchies. Then we extend some classes creating some derived classes. We must make sure that the new derived classes just extend without replacing the functionality of old classes. Otherwise, the new classes can produce undesired effects when they are used in existing program modules. Liskov's Substitution Principle states that if a program module is using a Base class, then the reference to the Base class can be replaced with a Derived class without affecting the functionality of the program module.



### __ISP__: Interface segregation principle

Rule: __Larger interfaces/abstract classes should be split into smaller ones. By doing so, we can ensure that implementing classes only need to be concerned about the methods that are of interest to them.__

Details:
- __Scope:__ Applies to interfaces (or abstract classes).
- __Rule:__ No client should be forced to depend on methods it does not use.
- __Focus:__ Separation of contracts.
- __Example:__ Don’t make a Worker interface with both work() and eat() if Robot only needs work()



### __DIP__: Dependency inversion principle

Rule: __Instead of high-level modules depending on low-level modules, both will depend on abstractions.__

Dependency injection = supplying required objects (via constructor for mandatory objects, and setter of not mandatory objects) from outside the class, usually via an interface/abstract class to promote loose coupling.

The high level classes are not working directly with low level classes, they are using interfaces as an abstract layer. High level modules should not depend on low level modules; both should depend on abstractions. Abstractions should not depend on details. Details should depend upon abstractions.

Using this principle implies an increased effort, will result in more classes and interfaces to maintain, in a few words in more complex code, but more flexible. This principle should not be applied blindly for every class or every module. This principle should be used in couple with Factory pattern.



### SOLID code example

Incorrect code:

    // Low-level module.
    class FileLogger {
        public void log(String message) {
            System.out.println("File log: " + message);
        }
    }
    
    // High-level module (depends directly on FileLogger).
    class Application {
        private FileLogger logger = new FileLogger();
    
        public void run() {
            logger.log("Application is running...");
        }
    }

Correct code:

    // Abstraction with shared behavior (abstract class).
    abstract class AbstractLogger {
        // Template method: stable public API.
        public final void log(String message) {
            String formatted = format(message);
            write(formatted);          // Defer the variable part to subclasses.
        }
    
        // Reusable hook (shared default behavior).
        protected String format(String message) {
            return "[APP] " + message; // You can add timestamps, thread id, etc.
        }
    
        // Variation point that subclasses must implement.
        protected abstract void write(String formattedMessage);
    }
    
    // Low-level module 1.
    class ConsoleLogger extends AbstractLogger {
        @Override
        protected void write(String formattedMessage) {
            System.out.println(formattedMessage);
        }
    }
    
    // Low-level module 2.
    class FileLogger extends AbstractLogger {
        @Override
        protected void write(String formattedMessage) {
            // pretend writing to a file here
            System.out.println("(file) " + formattedMessage);
        }
    }

    // High-level module depends on the abstraction (AbstractLogger).
    class Application {
        private final AbstractLogger logger;
    
        public Application(AbstractLogger logger) {
            this.logger = logger;
        }
    
        public void run() {
            logger.log("Application is running...");
        }
    }
    
    // Demo application.
    public class Main {
        public static void main(String[] args) {
            Application app1 = new Application(new ConsoleLogger());
            app1.run();
    
            Application app2 = new Application(new FileLogger());
            app2.run();
        }
    }